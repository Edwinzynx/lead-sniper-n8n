"""Embed user-supplied, unmodified n8n canvas screenshots in the demo guides."""
import hashlib
import json
import pathlib
import re
import shutil

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'demo-guides'
SOURCE = ROOT / 'screenshots of canvas'
MAPPING = {
    '00': [('setup and preflight.png', '00-setup-canvas.png', 'Setup and authenticated preflight: access checks, table creation, and baseline initialization.')],
    '10': [('main.png', '10-main-canvas.png', 'Main coordinator: triggers, conditional lease, lead loop, page loop, and lease release.')],
    '20': [('discover one page.png', '20-discovery-canvas.png', 'Discovery: page request, validation, candidate deduplication, and cursor/failure checkpoints.')],
    '30': [
        ('process lead 1.png', '30-process-lead-1.png', 'Part 1 — Control/lease checks, interrupted-send recovery, and profile request.'),
        ('process lead 2.png', '30-process-lead-2.png', 'Part 2 — Profile validation, qualification, profile persistence, and initial LLM generation.'),
        ('process lead 3.png', '30-process-lead-3.png', 'Part 3 — Pitch validation/repair and saving the pitch and Slack payload.'),
        ('process lead 4.png', '30-process-lead-4.png', 'Part 4 — Send authorization, sending checkpoint, Slack response handling, and durable outcomes.'),
    ],
    '40': [('record errors.png', '40-errors-canvas.png', 'Shared error recorder: Error Trigger, sanitized metadata, and persistent error record.')],
}

manifest_path = OUT / 'manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
count = 0
for entry in manifest:
    prefix = entry['guide'][:2]
    guide = OUT / entry['guide']
    text = guide.read_text(encoding='utf-8')
    screenshots = []
    section = ['## Visual reference', '',
        'Actual n8n canvas screenshots supplied by the project owner. Images are included unchanged; they show canvas layout, not proof that every branch executed successfully.', '']
    for original, dest, caption in MAPPING[prefix]:
        source = SOURCE / original
        target = OUT / 'images' / dest
        shutil.copy2(source, target)
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        assert digest == hashlib.sha256(target.read_bytes()).hexdigest()
        screenshots.append({'path': 'images/' + dest, 'source': original, 'sha256': digest, 'caption': caption})
        section.extend([f'### {caption}', '', f'![{caption}](images/{dest})', '', f'[Open full-resolution screenshot](images/{dest})', ''])
        count += 1
    if prefix == '10':
        section.extend(['**Demo correction:** the screenshot sticky note still says “Timeout 240s.” The configured timeout is **180 seconds**, the main cycle budget is **150 seconds**, and the lease lasts **600 seconds**. Quote the configured values in the demo. Green checks alone do not prove an AI-generated lead was delivered.', ''])
    if prefix == '30':
        section.extend(['**How to read these four views:** follow Parts 1–4 above. They overlap and crop some connecting lines. In Part 3, **When Executed by Another Workflow** is positioned on top of **AI Failed**, partially hiding its label. Its visual position does not mean it runs after pitch repair: logically the trigger starts at **Read Control**, as shown in the connection graph below. Every node, including the obscured one, is explained in this guide.', ''])
    section.extend(['### Supplemental node index', '',
        'The following SVG and Mermaid graph are generated from the workflow export. They provide readable node names and exact branch connections; they are diagrams, not screenshots.', '',
        f'![Generated node index](%s)' % entry['diagram'], ''])
    text = re.sub(r'## Visual reference\n.*?(?=## How to explain this workflow)', '\n'.join(section)+'\n', text, flags=re.S)
    text = re.sub(r'For a genuine canvas screenshot, open the live URL.*?readable node labels\.',
        'The supplied screenshots are embedded above. Use their full-resolution links to zoom into the canvas; use the generated graph and node explanations when a connection or label is cropped or overlapped.', text, flags=re.S)
    guide.write_text(text, encoding='utf-8')
    entry['screenshot'] = 'provided-and-embedded'
    entry['screenshots'] = screenshots

manifest_path.write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
index_path = OUT / 'README.md'
index = index_path.read_text(encoding='utf-8')
index = re.sub(r'\*\*Screenshot limitation:\*\*[^\n]*',
    '**Screenshots included:** eight actual n8n canvas screenshots supplied by the project owner, embedded in the matching guides. Process Lead uses four sequential views. Originals are preserved unchanged. Generated SVG/Mermaid diagrams are supplemental.', index)
index += '\n## Screenshot review notes\n\nMain’s sticky note contains a stale 240-second timeout; the guide calls out the actual 180-second limit. Process Lead Part 3 has an overlapping trigger/AI Failed label; the guide explains the logical entry point and the hidden node. Screenshots show layout, not full-path test evidence.\n' if '## Screenshot review notes' not in index else ''
index_path.write_text(index, encoding='utf-8')
print(f'Embedded {count} unchanged screenshots across {len(manifest)} guides; SHA-256 copies verified.')
