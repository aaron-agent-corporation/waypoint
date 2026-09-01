import type { WizardClassification, WizardSourceFile } from './types.ts'

/**
 * Generic source-file classification for the Wizard: bucket by media hint
 * and extension, never by domain-specific keywords. A bucketed file gets a
 * category directory in the shadow tree; anything unrecognized lands in
 * 'other' with review_required so the question flow can ask.
 */
const EXTENSION_BUCKETS: Readonly<Record<string, string>> = {
  '.pdf': 'documents',
  '.doc': 'documents',
  '.docx': 'documents',
  '.txt': 'documents',
  '.md': 'documents',
  '.rtf': 'documents',
  '.odt': 'documents',
  '.png': 'images',
  '.jpg': 'images',
  '.jpeg': 'images',
  '.gif': 'images',
  '.webp': 'images',
  '.tif': 'images',
  '.tiff': 'images',
  '.heic': 'images',
  '.svg': 'images',
  '.csv': 'spreadsheets',
  '.xls': 'spreadsheets',
  '.xlsx': 'spreadsheets',
  '.ods': 'spreadsheets',
  '.tsv': 'spreadsheets',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.m4a': 'audio',
  '.ogg': 'audio',
  '.flac': 'audio',
  '.mp4': 'video',
  '.mov': 'video',
  '.webm': 'video',
  '.mkv': 'video',
  '.zip': 'archives',
  '.tar': 'archives',
  '.gz': 'archives',
  '.7z': 'archives',
  '.rar': 'archives',
  '.eml': 'correspondence',
  '.msg': 'correspondence',
}

function bucketForMediaHint(mediaHint: string): string | null {
  if (mediaHint.startsWith('image/')) return 'images'
  if (mediaHint.startsWith('audio/')) return 'audio'
  if (mediaHint.startsWith('video/')) return 'video'
  if (mediaHint === 'application/pdf') return 'documents'
  if (mediaHint.startsWith('text/')) return 'documents'
  return null
}

export function classifyWizardSourceFile(file: WizardSourceFile): WizardClassification {
  const extension = (file.extension ?? '').toLowerCase()
  const fromExtension = extension === '' ? null : EXTENSION_BUCKETS[extension] ?? null
  if (fromExtension !== null && fromExtension !== undefined) {
    return {
      kind: fromExtension,
      confidence: 'high',
      rationale: `extension ${extension}`,
      review_required: false,
    }
  }
  const fromMedia = bucketForMediaHint(file.media_hint ?? '')
  if (fromMedia !== null) {
    return {
      kind: fromMedia,
      confidence: 'medium',
      rationale: `media hint ${file.media_hint}`,
      review_required: false,
    }
  }
  return {
    kind: 'other',
    confidence: 'low',
    rationale: 'no recognized extension or media hint',
    review_required: true,
  }
}
