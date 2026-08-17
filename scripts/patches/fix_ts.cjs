const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'app/dashboard.tsx');
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/w => w\.id/g, '(w: any) => w.id');
content = content.replace(/r => mapBudget/g, '(r: any) => mapBudget');
content = content.replace(/r => mapGoal/g, '(r: any) => mapGoal');
content = content.replace(/file => \`/g, '(file: any) => `');

fs.writeFileSync(file, content, 'utf8');
