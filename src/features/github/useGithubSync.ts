import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSelector } from '@tanstack/react-store'
import { toast } from 'sonner'

import { plannerStore } from '#/lib/planner/store.ts'
import { toProjectRecord } from '#/lib/planner/planSerialization.ts'

import {
  beginGithubConnection,
  commitGithubChanges,
  disconnectGithub,
  getGithubConnectionStatus,
  getGithubSnapshot,
  listGithubRepositories,
  selectGithubRepository,
} from './githubFunctions.ts'
import { deriveGitHubWorkspaceChanges } from './dirtyState.ts'
import {
  planGitHubLocalDiscard,
  planGitHubReconciliation,
  resolveGitHubSyncConflict,
} from './reconciliation.ts'
import { toGitHubRemoteSnapshot } from './remoteSnapshot.ts'
import {
  describeGitHubConflict,
  describeGitHubDiscard,
  isGitHubConflictResolvable,
} from './syncStatus.ts'
import { isRepositoryEventMessage } from './repositoryEvents.ts'
import {
  GITHUB_WORKSPACE_STORAGE_KEY,
  clearGitHubWorkspaceState,
  createGitHubWorkspaceState,
  readGitHubWorkspaceState,
  setGitHubProjectSelected,
  writeGitHubWorkspaceState,
} from './storage.ts'

import type {
  GithubConnectionStatus,
  GithubErrorPayload,
  GithubRepositorySnapshot,
  GithubRepositorySummary,
  GithubSelectedRepository,
} from './contracts.ts'
import type {
  GitHubConflictResolution,
  GitHubReconciliationPlan,
  GitHubRemoteSnapshot,
  GitHubSyncConflict,
  GitHubWorkspaceChanges,
  GitHubWorkspaceState,
} from './types.ts'
import type { Project } from '#/lib/planner/types.ts'

const EMPTY_CHANGES: GitHubWorkspaceChanges = {
  added: [],
  updated: [],
  deleted: [],
  unchanged: [],
  changeCount: 0,
  hasChanges: false,
  blockedByConflicts: false,
  canCommit: false,
}

type LiveState = 'disconnected' | 'connecting' | 'connected' | 'offline'

export type GitHubSyncDisplayState =
  | 'disconnected'
  | 'local-only'
  | 'up-to-date'
  | 'pending-changes'
  | 'remote-update'
  | 'committing'
  | 'offline'
  | 'access-revoked'
  | 'conflict'

export interface GitHubReviewState {
  plan: GitHubReconciliationPlan
  remote: GitHubRemoteSnapshot
  snapshot: GithubRepositorySnapshot
}

export interface GitHubSyncController {
  /** Every plan in the library, the open one brought up to date. */
  projects: Project[]
  connection: GithubConnectionStatus | null
  connectionLoading: boolean
  connectionError: GithubErrorPayload | null
  repositories: GithubRepositorySummary[]
  repositoriesLoading: boolean
  repository: GithubSelectedRepository | null
  workspace: GitHubWorkspaceState | null
  changes: GitHubWorkspaceChanges
  review: GitHubReviewState | null
  displayState: GitHubSyncDisplayState
  liveState: LiveState
  busy: boolean
  actionError: GithubErrorPayload | null
  lastCommitUrl: string | null
  isProjectSelected: (projectId: string) => boolean
  setProjectSelected: (projectId: string, selected: boolean) => void
  beginConnection: () => Promise<void>
  refreshRepositories: () => Promise<void>
  selectRepository: (repositoryId: string) => Promise<boolean>
  refresh: () => Promise<void>
  /** Settles one conflict in favour of GitHub's file or this browser's plan. */
  resolveConflict: (
    conflict: GitHubSyncConflict,
    resolution: GitHubConflictResolution,
  ) => Promise<boolean>
  /** The same choice, made once for every conflict that can take it. */
  resolveAllConflicts: (
    resolution: GitHubConflictResolution,
  ) => Promise<boolean>
  confirmReview: () => Promise<boolean>
  commit: (message: string) => Promise<boolean>
  /**
   * Throws away what is waiting to commit and takes the repository's copy.
   * Given plan IDs, only those are put back; everything else keeps waiting.
   */
  discardLocalChanges: (projectIds?: Array<string>) => Promise<boolean>
  disconnect: () => Promise<boolean>
}

function browserWorkspace(): GitHubWorkspaceState | null {
  return typeof window === 'undefined'
    ? null
    : readGitHubWorkspaceState(window.localStorage)
}

function browserReturnPath(): string {
  const url = new URL(window.location.href)
  url.searchParams.delete('github')
  return `${url.pathname}${url.search}${url.hash}`
}

function websocketUrl(): string {
  const url = new URL('/api/github/events', window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

/**
 * How long the plans have to stand still before they are hashed again.
 *
 * The library is the store, and the store moves with the pointer: dragging a
 * wall replaces `walls` on every frame. Hashing every plan at that rate to
 * find out whether anything is waiting to commit would be work thrown away
 * sixty times a second, so the answer is allowed to arrive a moment late. It
 * is a badge on a button, not something anyone is waiting on.
 */
const HASH_DEBOUNCE_MS = 250

/**
 * The library as it stands, in a form React can hold on to.
 *
 * The store's own `currentProjects` builds a fresh array every call, which a
 * reference-comparing selector would read as a change on every store update —
 * every pan, every hover. So the parts are subscribed to separately, each of
 * them a reference the store only replaces when it means it, and the merge is
 * memoized over those.
 */
function usePlannerProjects(): Project[] {
  const projects = useSelector(plannerStore, (s) => s.projects)
  const projectId = useSelector(plannerStore, (s) => s.projectId)
  const walls = useSelector(plannerStore, (s) => s.walls)
  const furniture = useSelector(plannerStore, (s) => s.furniture)
  const openings = useSelector(plannerStore, (s) => s.openings)
  const spaces = useSelector(plannerStore, (s) => s.spaces)

  return useMemo(
    () =>
      projects.map((project) =>
        project.id === projectId
          ? { ...project, walls, furniture, openings, spaces }
          : project,
      ),
    [projects, projectId, walls, furniture, openings, spaces],
  )
}

export function useGithubSync(): GitHubSyncController {
  const projects = usePlannerProjects()
  const queryClient = useQueryClient()
  const [workspace, setWorkspace] = useState(browserWorkspace)
  const [changes, setChanges] = useState(EMPTY_CHANGES)
  const [review, setReview] = useState<GitHubReviewState | null>(null)
  const [liveState, setLiveState] = useState<LiveState>(
    typeof navigator !== 'undefined' && !navigator.onLine
      ? 'offline'
      : 'disconnected',
  )
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<GithubErrorPayload | null>(
    null,
  )
  const [lastCommitUrl, setLastCommitUrl] = useState<string | null>(null)
  const projectsRef = useRef(projects)
  const workspaceRef = useRef(workspace)
  const snapshotRef = useRef<(() => Promise<unknown>) | undefined>(undefined)

  projectsRef.current = projects
  workspaceRef.current = workspace

  const persistWorkspace = useCallback(
    (
      next:
        | GitHubWorkspaceState
        | null
        | ((
            current: GitHubWorkspaceState | null,
          ) => GitHubWorkspaceState | null),
    ) => {
      setWorkspace((current) => {
        const value = typeof next === 'function' ? next(current) : next
        if (value) writeGitHubWorkspaceState(window.localStorage, value)
        else clearGitHubWorkspaceState(window.localStorage)
        workspaceRef.current = value
        return value
      })
    },
    [],
  )

  const connectionQuery = useQuery({
    queryKey: ['github', 'connection'],
    queryFn: () => getGithubConnectionStatus(),
    retry: false,
    staleTime: 10_000,
  })
  const refetchConnection = connectionQuery.refetch
  const connectionResult = connectionQuery.data
  const connection = connectionResult?.ok ? connectionResult.data : null
  const connectionError =
    connectionResult?.ok === false ? connectionResult.error : null
  const repository =
    connection?.status === 'connected' ? connection.repository : null

  const repositoriesQuery = useQuery({
    queryKey: ['github', 'repositories'],
    queryFn: () => listGithubRepositories(),
    enabled: connection?.status === 'connected',
    retry: false,
    staleTime: 60_000,
  })
  const refetchRepositoriesQuery = repositoriesQuery.refetch
  const repositories = repositoriesQuery.data?.ok
    ? repositoriesQuery.data.data.repositories
    : []

  const snapshotQuery = useQuery({
    queryKey: ['github', 'snapshot', repository?.id ?? null],
    queryFn: () => getGithubSnapshot(),
    enabled:
      repository !== null &&
      workspace?.repositoryId === repository.id &&
      (typeof navigator === 'undefined' || navigator.onLine),
    retry: false,
    staleTime: 0,
  })
  const refetchSnapshot = snapshotQuery.refetch
  snapshotRef.current = async () => refetchSnapshot()

  const processSnapshot = useCallback(
    async (snapshot: GithubRepositorySnapshot, announce: boolean) => {
      const current = workspaceRef.current
      if (!current || current.repositoryId !== snapshot.repository.id) return

      if (
        current.baseHeadSha === snapshot.headSha &&
        current.conflicts.length === 0
      ) {
        setReview(null)
        return
      }

      const remote = toGitHubRemoteSnapshot(snapshot)
      const plan = await planGitHubReconciliation(
        current,
        projectsRef.current,
        remote,
      )
      setReview({ plan, remote, snapshot })
      if (plan.conflicts.length > 0) {
        persistWorkspace({ ...current, conflicts: plan.conflicts })
      }
      if (announce)
        toast.info('GitHub has newer changes', {
          description: 'Review them before they affect this browser.',
        })
    },
    [persistWorkspace],
  )

  useEffect(() => {
    if (!repository) return
    if (workspaceRef.current?.repositoryId === repository.id) return
    setReview(null)
    persistWorkspace(createGitHubWorkspaceState(repository.id))
  }, [persistWorkspace, repository])

  useEffect(() => {
    if (!workspace) {
      setChanges(EMPTY_CHANGES)
      return
    }
    let active = true
    const timer = setTimeout(() => {
      void deriveGitHubWorkspaceChanges(workspace, projects).then((next) => {
        if (active) setChanges(next)
      })
    }, HASH_DEBOUNCE_MS)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [projects, workspace])

  useEffect(() => {
    if (!workspace) return
    const localIds = new Set(projects.map((project) => project.id))
    const selectedProjectIds = workspace.selectedProjectIds.filter(
      (projectId) =>
        localIds.has(projectId) || workspace.baseProjects[projectId],
    )
    if (selectedProjectIds.length !== workspace.selectedProjectIds.length) {
      persistWorkspace({ ...workspace, selectedProjectIds })
    }
  }, [persistWorkspace, projects, workspace])

  useEffect(() => {
    const result = snapshotQuery.data
    if (!result?.ok) return
    void processSnapshot(result.data, true)
  }, [processSnapshot, snapshotQuery.data, snapshotQuery.dataUpdatedAt])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== GITHUB_WORKSPACE_STORAGE_KEY) return
      const next = readGitHubWorkspaceState(window.localStorage)
      workspaceRef.current = next
      setWorkspace(next)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    const outcome = new URL(window.location.href).searchParams.get('github')
    if (!outcome) return
    if (outcome === 'connected') toast.success('GitHub connected')
    else toast.error('GitHub could not be connected')
    const url = new URL(window.location.href)
    url.searchParams.delete('github')
    window.history.replaceState(
      null,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    )
    void refetchConnection()
  }, [refetchConnection])

  useEffect(() => {
    if (!repository) {
      setLiveState('disconnected')
      return
    }

    let active = true
    let socket: WebSocket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0

    const connect = () => {
      if (!active || socket) return
      if (!navigator.onLine) {
        setLiveState('offline')
        return
      }
      setLiveState('connecting')
      socket = new WebSocket(websocketUrl())
      socket.addEventListener('open', () => {
        attempt = 0
        setLiveState('connected')
        void snapshotRef.current?.()
      })
      socket.addEventListener('message', (event) => {
        try {
          const value: unknown = JSON.parse(String(event.data))
          if (!isRepositoryEventMessage(value)) return
          if (value.repositoryId !== repository.id) return
          if (value.type === 'access-changed') {
            toast.error('GitHub repository access changed')
            void refetchConnection()
            return
          }
          if (workspaceRef.current?.baseHeadSha !== value.headSha) {
            void snapshotRef.current?.()
          }
        } catch {
          // Unknown socket data is ignored; this channel never carries content.
        }
      })
      socket.addEventListener('close', () => {
        socket = null
        if (!active) return
        setLiveState(navigator.onLine ? 'connecting' : 'offline')
        const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5))
        attempt += 1
        retryTimer = setTimeout(connect, delay)
      })
    }

    const onOnline = () => connect()
    const onOffline = () => {
      setLiveState('offline')
      socket?.close(1000, 'Offline')
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    connect()

    return () => {
      active = false
      if (retryTimer) clearTimeout(retryTimer)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      socket?.close(1000, 'Closed')
    }
  }, [refetchConnection, repository])

  const isProjectSelected = useCallback(
    (projectId: string) =>
      workspace?.selectedProjectIds.includes(projectId) === true,
    [workspace],
  )

  const setProjectSelected = useCallback(
    (projectId: string, selected: boolean) => {
      persistWorkspace((current) =>
        current
          ? setGitHubProjectSelected(current, projectId, selected)
          : current,
      )
    },
    [persistWorkspace],
  )

  const beginConnection = useCallback(async () => {
    setBusy(true)
    setActionError(null)
    try {
      const begun = await beginGithubConnection({
        data: { returnPath: browserReturnPath() },
      })
      if (!begun.ok) {
        setActionError(begun.error)
        toast.error(begun.error.message)
        return
      }
      window.location.assign(begun.data.authorizeUrl)
    } catch {
      toast.error('GitHub could not be reached. Try again when you are online.')
    } finally {
      setBusy(false)
    }
  }, [])

  const refreshRepositories = useCallback(async () => {
    setActionError(null)
    const refreshed = await refetchRepositoriesQuery()
    if (refreshed.data?.ok === false) {
      setActionError(refreshed.data.error)
      toast.error(refreshed.data.error.message)
    }
  }, [refetchRepositoriesQuery])

  const chooseRepository = useCallback(
    async (repositoryId: string) => {
      setBusy(true)
      setActionError(null)
      try {
        const selected = await selectGithubRepository({
          data: { repositoryId },
        })
        if (!selected.ok) {
          setActionError(selected.error)
          toast.error(selected.error.message)
          return false
        }
        const next = createGitHubWorkspaceState(repositoryId)
        persistWorkspace(next)
        await refetchConnection()
        queryClient.setQueryData(['github', 'snapshot', repositoryId], {
          ok: true,
          data: selected.data.snapshot,
        })
        await processSnapshot(selected.data.snapshot, false)
        return true
      } catch {
        toast.error('The repository could not be selected.')
        return false
      } finally {
        setBusy(false)
      }
    },
    [persistWorkspace, processSnapshot, queryClient, refetchConnection],
  )

  const refresh = useCallback(async () => {
    setActionError(null)
    const refreshed = await refetchSnapshot()
    if (refreshed.data?.ok) {
      await processSnapshot(refreshed.data.data, false)
    } else if (refreshed.data?.ok === false) {
      setActionError(refreshed.data.error)
      toast.error(refreshed.data.error.message)
    }
  }, [processSnapshot, refetchSnapshot])

  /**
   * Settles conflicts against the review already in hand.
   *
   * Deciding a conflict needs no network: the snapshot being reviewed holds
   * GitHub's parsed plans, so both candidate copies are already here. The
   * decisions are folded in one after another so a batch sees the state the
   * one before it left, then the whole review is re-planned from the same
   * snapshot — which is what clears the settled conflicts and shows whatever
   * is still outstanding.
   */
  const applyResolutions = useCallback(
    async (
      entries: Array<{
        conflict: GitHubSyncConflict
        resolution: GitHubConflictResolution
      }>,
    ) => {
      const currentReview = review
      const current = workspaceRef.current
      if (!currentReview || !current || entries.length === 0) return false

      setBusy(true)
      setActionError(null)
      try {
        let nextState = current
        let nextProjects = projectsRef.current
        const upserts: Project[] = []

        for (const { conflict, resolution } of entries) {
          const settled = resolveGitHubSyncConflict(
            nextState,
            nextProjects,
            currentReview.remote,
            conflict,
            resolution,
          )
          if (!settled) continue
          nextState = settled.state
          if (settled.projectUpserts.length === 0) continue
          upserts.push(...settled.projectUpserts)
          const byId = new Map(
            settled.projectUpserts.map((project) => [project.id, project]),
          )
          nextProjects = [
            ...nextProjects.map((project) => byId.get(project.id) ?? project),
            ...settled.projectUpserts.filter(
              (project) =>
                !nextProjects.some((existing) => existing.id === project.id),
            ),
          ]
        }

        if (nextState === current && upserts.length === 0) {
          toast.error('That conflict has to be settled on GitHub.')
          return false
        }

        // The library is the store's, not this hook's: it writes the accepted
        // plans in, and its own autosave puts them in the browser.
        plannerStore.actions.upsertProjects(upserts)

        const plan = await planGitHubReconciliation(
          nextState,
          nextProjects,
          currentReview.remote,
        )
        persistWorkspace({ ...nextState, conflicts: plan.conflicts })
        setReview({ ...currentReview, plan })
        return true
      } catch {
        toast.error('That choice could not be saved in this browser.')
        return false
      } finally {
        setBusy(false)
      }
    },
    [persistWorkspace, review],
  )

  const resolveConflict = useCallback(
    async (
      conflict: GitHubSyncConflict,
      resolution: GitHubConflictResolution,
    ) => {
      const settled = await applyResolutions([{ conflict, resolution }])
      if (settled) {
        const copy = describeGitHubConflict(
          conflict,
          projectsRef.current.some(
            (project) => project.id === conflict.projectId,
          ),
        )
        const label =
          resolution === 'remote' ? copy.remoteLabel : copy.localLabel
        toast.success(
          resolution === 'local'
            ? `${label ?? 'Browser version kept'} — commit to update GitHub`
            : (label ?? 'GitHub version kept'),
        )
      }
      return settled
    },
    [applyResolutions],
  )

  const resolveAllConflicts = useCallback(
    async (resolution: GitHubConflictResolution) => {
      const conflicts = review?.plan.conflicts ?? []
      const resolvable = conflicts.filter(isGitHubConflictResolvable)
      if (resolvable.length === 0) {
        toast.error('These conflicts have to be settled on GitHub.')
        return false
      }

      const settled = await applyResolutions(
        resolvable.map((conflict) => ({ conflict, resolution })),
      )
      if (settled) {
        const blocked = conflicts.length - resolvable.length
        toast.success(
          resolution === 'remote'
            ? "GitHub's copies kept"
            : 'Your copies kept — commit to send them to GitHub',
          blocked > 0
            ? {
                description: `${blocked} unreadable ${
                  blocked === 1 ? 'file' : 'files'
                } still need fixing on GitHub.`,
              }
            : undefined,
        )
      }
      return settled
    },
    [applyResolutions, review],
  )

  const confirmReview = useCallback(async () => {
    const currentReview = review
    const currentWorkspace = workspaceRef.current
    if (!currentReview || !currentWorkspace) return false

    setBusy(true)
    try {
      const latestPlan = await planGitHubReconciliation(
        currentWorkspace,
        projectsRef.current,
        currentReview.remote,
      )
      if (latestPlan.conflicts.length > 0) {
        persistWorkspace({
          ...currentWorkspace,
          conflicts: latestPlan.conflicts,
        })
        setReview({ ...currentReview, plan: latestPlan })
        toast.error('Resolve the conflict on GitHub, then check again.')
        return false
      }

      // The library is the store's, not this hook's: it writes the accepted
      // plans in, and its own autosave puts them in the browser.
      plannerStore.actions.upsertProjects(latestPlan.projectUpserts)
      persistWorkspace(latestPlan.nextState)
      setReview(null)
      toast.success('GitHub changes applied')
      return true
    } catch {
      toast.error('The reviewed changes could not be saved in this browser.')
      return false
    } finally {
      setBusy(false)
    }
  }, [persistWorkspace, review])

  const commit = useCallback(
    async (message: string) => {
      const current = workspaceRef.current
      if (!current || !changes.canCommit || review) return false
      const localById = new Map(
        projectsRef.current.map((project) => [project.id, project]),
      )
      const writes = [...changes.added, ...changes.updated]
        .map((projectId) => localById.get(projectId))
        .filter((project): project is Project => project !== undefined)

      setBusy(true)
      setActionError(null)
      try {
        const committed = await commitGithubChanges({
          data: {
            baseHeadSha: current.baseHeadSha,
            message,
            writes: writes.map(toProjectRecord),
            deletions: changes.deleted,
          },
        })
        if (!committed.ok) {
          setActionError(committed.error)
          toast.error(committed.error.message)
          if (committed.error.code === 'stale-head') await refresh()
          return false
        }

        const remote = toGitHubRemoteSnapshot(committed.data.snapshot)
        const plan = await planGitHubReconciliation(
          current,
          projectsRef.current,
          remote,
        )
        if (plan.conflicts.length > 0) {
          persistWorkspace({ ...current, conflicts: plan.conflicts })
          setReview({ plan, remote, snapshot: committed.data.snapshot })
          toast.info(
            'The commit succeeded, but GitHub changed again. Review it.',
          )
          return true
        }
        persistWorkspace(plan.nextState)
        setLastCommitUrl(committed.data.commitUrl)
        setReview(null)
        queryClient.setQueryData(
          ['github', 'snapshot', committed.data.snapshot.repository.id],
          { ok: true, data: committed.data.snapshot },
        )
        toast.success('Changes committed to GitHub', {
          action: {
            label: 'View commit',
            onClick: () => window.open(committed.data.commitUrl, '_blank'),
          },
        })
        return true
      } catch {
        toast.error('The commit could not reach GitHub. Your plans are safe.')
        return false
      } finally {
        setBusy(false)
      }
    },
    [changes, persistWorkspace, queryClient, refresh, review],
  )

  /**
   * Throw away what is waiting to commit and take the repository's copy.
   *
   * The snapshot is fetched again first, because a discard only means anything
   * against a repository that has not moved: if GitHub is ahead, the copy that
   * would arrive is not the copy the dialog offered to restore, and the review
   * is the honest way in. So a moved head backs out and leaves the refetch to
   * raise the review it has just discovered.
   *
   * Standing conflicts are the review's business rather than this one's —
   * `resolveAllConflicts` is the same choice, made where it is explained — and
   * they can outlive a reload while the first snapshot is still in flight, so
   * they are turned away here as well as hidden in the dialog.
   */
  const discardLocalChanges = useCallback(
    async (projectIds?: Array<string>) => {
      const current = workspaceRef.current
      if (!current || review || current.conflicts.length > 0) return false

      setBusy(true)
      setActionError(null)
      try {
        const refreshed = await refetchSnapshot()
        const result = refreshed.data
        if (result?.ok !== true) {
          if (result?.ok === false) {
            setActionError(result.error)
            toast.error(result.error.message)
          } else {
            toast.error(
              'GitHub could not be reached, so nothing was discarded.',
            )
          }
          return false
        }
        if (result.data.headSha !== current.baseHeadSha) {
          toast.info('GitHub changed', {
            description: 'Review what arrived before discarding anything.',
          })
          return false
        }

        const plan = await planGitHubLocalDiscard(
          current,
          projectsRef.current,
          toGitHubRemoteSnapshot(result.data),
          projectIds,
        )
        if (!plan.hasWork) {
          toast.info('There was nothing to discard.')
          return false
        }

        // The library is the store's, not this hook's: it writes the
        // repository's plans in, and its own autosave puts them in the browser.
        plannerStore.actions.upsertProjects(plan.projectUpserts)
        persistWorkspace(plan.nextState)
        // Where every plan already matched, nothing was thrown away and saying
        // so would be a lie: only what this browser had written down moved.
        const discarded =
          plan.reverted.length + plan.recovered.length + plan.unlinked.length >
          0
        toast.success(
          discarded
            ? 'Local changes discarded'
            : 'Sync record brought up to date',
          {
            description: describeGitHubDiscard({
              reverted: plan.reverted.length,
              recovered: plan.recovered.length,
              unlinked: plan.unlinked.length,
              realigned: plan.realigned.length,
            }),
          },
        )
        return true
      } catch {
        toast.error(
          'The changes could not be discarded. Your plans are as they were.',
        )
        return false
      } finally {
        setBusy(false)
      }
    },
    [persistWorkspace, refetchSnapshot, review],
  )

  const disconnect = useCallback(async () => {
    setBusy(true)
    setActionError(null)
    try {
      const disconnected = await disconnectGithub()
      if (!disconnected.ok) {
        setActionError(disconnected.error)
        toast.error(disconnected.error.message)
        return false
      }
      persistWorkspace(null)
      setReview(null)
      setLastCommitUrl(null)
      await queryClient.invalidateQueries({ queryKey: ['github'] })
      toast.success('GitHub disconnected')
      return true
    } catch {
      toast.error('GitHub could not be disconnected just now.')
      return false
    } finally {
      setBusy(false)
    }
  }, [persistWorkspace, queryClient])

  const displayState = useMemo<GitHubSyncDisplayState>(() => {
    if (connection?.status === 'access-revoked') return 'access-revoked'
    if (!connection || connection.status === 'disconnected')
      return 'disconnected'
    if (!repository || !workspace) return 'local-only'
    if (busy && changes.hasChanges) return 'committing'
    if (liveState === 'offline') return 'offline'
    if (workspace.conflicts.length > 0 || review?.plan.conflicts.length) {
      return 'conflict'
    }
    if (review) return 'remote-update'
    if (changes.hasChanges) return 'pending-changes'
    return 'up-to-date'
  }, [
    busy,
    changes.hasChanges,
    connection,
    liveState,
    repository,
    review,
    workspace,
  ])

  return {
    projects,
    connection,
    connectionLoading: connectionQuery.isLoading,
    connectionError,
    repositories,
    repositoriesLoading: repositoriesQuery.isFetching,
    repository,
    workspace,
    changes,
    review,
    displayState,
    liveState,
    busy,
    actionError,
    lastCommitUrl,
    isProjectSelected,
    setProjectSelected,
    beginConnection,
    refreshRepositories,
    selectRepository: chooseRepository,
    refresh,
    resolveConflict,
    resolveAllConflicts,
    confirmReview,
    commit,
    discardLocalChanges,
    disconnect,
  }
}
