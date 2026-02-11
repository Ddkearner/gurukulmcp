const fs = require('fs');

// Read the current index.ts
const indexPath = 'src/index.ts';
const handlersPath = 'inventory_handlers.txt';

const indexContent = fs.readFileSync(indexPath, 'utf8');
const handlersContent = fs.readFileSync(handlersPath, 'utf8');

// Find the insertion point (after delete_visitor_log case)
const insertionMarker = '            case "delete_visitor_log": {\r\n                const { id } = z.object({ id: z.number() }).parse(args);\r\n                await pool.execute("DELETE FROM visitor_log WHERE id = ?", [id]);\r\n                return { content: [{ type: "text", text: `Visitor log ${id} deleted.` }] };\r\n            }';

const insertionIndex = indexContent.indexOf(insertionMarker);

if (insertionIndex === -1) {
    console.error('Could not find insertion point!');
    process.exit(1);
}

// Calculate where to insert (after the closing brace and newlines)
const insertPoint = insertionIndex + insertionMarker.length + 2; // +2 for \r\n

// Insert the handlers
const newContent = indexContent.slice(0, insertPoint) + '\r\n' + handlersContent + '\r\n' + indexContent.slice(insertPoint);

// Write back
fs.writeFileSync(indexPath, newContent, 'utf8');

console.log('✅ Successfully inserted inventory handlers!');
console.log(`Inserted at position: ${insertPoint}`);
console.log(`Total handlers added: 16`);
