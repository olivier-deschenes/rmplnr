/**
 * The questions the landing page answers, and the source of its FAQ markup.
 *
 * The structured data has to say exactly what the page says, so both read from
 * this list rather than keeping two copies that can drift apart.
 */
export type FaqEntry = {
  question: string
  answer: string
}

export const FAQ: Array<FaqEntry> = [
  {
    question: 'Is rmplnr free to use?',
    answer:
      'Yes. rmplnr is a free room planner with no account, no sign-up, and no trial. Open the editor and start drawing.',
  },
  {
    question: 'Where are my floor plans saved?',
    answer:
      'In this browser, on this device. Plans are kept in local storage, so they are there when you come back and they never leave unless you export them or turn on GitHub sync yourself.',
  },
  {
    question: 'Can I plan in feet and inches?',
    answer:
      'Yes. Every plan can be shown in metric or imperial, and switching between them only changes how the measurements are written — the drawing itself is untouched.',
  },
  {
    question: 'Can I trace an existing floor plan?',
    answer:
      'Yes. Drop in a PDF or an image of a floor plan, set its scale against a wall you know the length of, and draw your rooms straight over the top of it.',
  },
  {
    question: 'How do I check whether furniture fits?',
    answer:
      'Draw the room to your own measurements, then place furniture at its real size. Everything is drawn to scale with live dimensions, so walkways and clearances are there to read as you move things around.',
  },
  {
    question: 'Can I share a plan or get it out of the browser?',
    answer:
      'Yes. A plan can be exported as JSON or as a PNG drawing, shared as a link that carries the plan inside it, or synced to a GitHub repository you choose.',
  },
]
