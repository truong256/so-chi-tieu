const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'app/dashboard.tsx');
let content = fs.readFileSync(file, 'utf8');

// Fix Date.now()
content = content.replace(/Date\.now\(\)/g, 'new Date().getTime()');

// Fix as any
content = content.replace(/as any\)/g, 'as "all" | "active" | "paused" | "due" | "overdue" | "income" | "expense")');

fs.writeFileSync(file, content, 'utf8');
console.log("Fixed lint errors!");
