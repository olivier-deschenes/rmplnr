import { FAQ } from './faq.ts'
import {
  DEFAULT_DESCRIPTION,
  OG_IMAGE,
  SITE_NAME,
  SITE_URL,
  absoluteUrl,
} from './seo.ts'

/**
 * The landing page, described for the machines that read it.
 *
 * Three linked nodes: the site, the application it offers, and the questions
 * the page answers. Everything asserted here is also on the page in words —
 * schema that says more than the page does is schema Google throws out.
 */
const WEBSITE_ID = `${SITE_URL}/#website`
const APPLICATION_ID = `${SITE_URL}/#application`

export function landingStructuredData(): Record<string, unknown> {
  const graph = [
    {
      '@type': 'WebSite',
      '@id': WEBSITE_ID,
      url: `${SITE_URL}/`,
      name: SITE_NAME,
      description: DEFAULT_DESCRIPTION,
      inLanguage: 'en',
    },
    {
      '@type': 'WebApplication',
      '@id': APPLICATION_ID,
      name: SITE_NAME,
      url: `${SITE_URL}/`,
      description: DEFAULT_DESCRIPTION,
      applicationCategory: 'DesignApplication',
      applicationSubCategory: 'Room and floor plan planner',
      operatingSystem: 'Any modern web browser',
      browserRequirements: 'Requires JavaScript.',
      isPartOf: { '@id': WEBSITE_ID },
      image: OG_IMAGE.url,
      screenshot: OG_IMAGE.url,
      // Free, with nothing held back behind a sign-up.
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
      },
      featureList: [
        'Draw rectangular and polygon rooms to your own measurements',
        'Place doors, windows, and open passages in walls',
        'Arrange furniture at real size and check clearances',
        'Read live dimensions in metric or imperial units',
        'Trace over a PDF or image of an existing floor plan',
        'Export plans as JSON or PNG, or share them as a link',
        'Work without an account, with plans saved in the browser',
      ],
    },
    {
      '@type': 'FAQPage',
      '@id': `${SITE_URL}/#faq`,
      isPartOf: { '@id': WEBSITE_ID },
      mainEntity: FAQ.map((entry) => ({
        '@type': 'Question',
        name: entry.question,
        acceptedAnswer: { '@type': 'Answer', text: entry.answer },
      })),
    },
  ]

  return { '@context': 'https://schema.org', '@graph': graph }
}

/** The absolute URL of the landing page, for the canonical and the sitemap. */
export const LANDING_URL = absoluteUrl('/')
