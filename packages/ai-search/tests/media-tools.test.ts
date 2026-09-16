import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/chatoffice', () => ({
  chatofficeGenerateImage: vi.fn(),
  gskAnalyzeMedia: vi.fn(),
  hasGskAuth: vi.fn(() => true),
}))

import { generateImageTool, GSK_RMBG_MODEL } from '../src/media-tools'
import { chatofficeGenerateImage as gskGenerateImage } from '../src/chatoffice'

const gskGen = vi.mocked(gskGenerateImage)
// nonexistent settings file → defaults: no BYOK media provider, cloud tools on → Genspark route
const SETTINGS = '/nonexistent/ai-settings.json'

beforeEach(() => {
  gskGen.mockReset()
})
