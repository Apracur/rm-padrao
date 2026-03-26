const fs = require('fs');
let content = fs.readFileSync('public/index.html', 'utf8');

// 1. Replace lucide CDN with lucide-react UMD
content = content.replace(
  '<script src="https://unpkg.com/lucide@latest"></script>',
  '<script src="https://unpkg.com/lucide-react@latest/dist/umd/lucide-react.js"></script>'
);

// 2. At the top of the babel script, destructure lucide-react icons
// Insert after: const { useState, useEffect, useRef, useCallback, useMemo } = React;
content = content.replace(
  'const { useState, useEffect, useRef, useCallback, useMemo } = React;\n    const { createClient } = window.supabase;',
  `const { useState, useEffect, useRef, useCallback, useMemo } = React;
    const { createClient } = window.supabase;

    // Lucide React icons - destructured from UMD build
    const LucidePlus = window.LucideReact?.Plus || window['lucide-react']?.Plus;
    const LucideLogOut = window.LucideReact?.LogOut || window['lucide-react']?.LogOut;
    const LucideSearch = window.LucideReact?.Search || window['lucide-react']?.Search;
    const LucidePackage = window.LucideReact?.Package || window['lucide-react']?.Package;
    const LucideCheck = window.LucideReact?.Check || window['lucide-react']?.Check;
    const LucideFileText = window.LucideReact?.FileText || window['lucide-react']?.FileText;
    const LucideChevronDown = window.LucideReact?.ChevronDown || window['lucide-react']?.ChevronDown;
    const LucideUpload = window.LucideReact?.Upload || window['lucide-react']?.Upload;
    const LucideDownload = window.LucideReact?.Download || window['lucide-react']?.Download;
    const LucideSave = window.LucideReact?.Save || window['lucide-react']?.Save;
    const LucideSettings = window.LucideReact?.Settings || window['lucide-react']?.Settings;`
);

console.log('Step 1 & 2 done. Checking if CDN replaced:', content.includes('lucide-react'));

// 3. Replace all lucide icon JSX usages with named components
const replacements = [
  [/<lucide\.icons\[item\.icon\] size=\{20\} \/>/g, '{ItemIcon && <ItemIcon size={20} />}'],
  [/<lucide\.icons\.LogOut size=\{18\} \/>/g, '<LucideLogOut size={18} />'],
  [/lucide\.icons\.Search/g, 'LucideSearch'],
  [/<lucide\.icons\.Package size=\{48\} className="mx-auto text-gray-300 mb-3" \/>/g, '<LucidePackage size={48} className="mx-auto text-gray-300 mb-3" />'],
  [/<lucide\.icons\.Check size=\{20\} \/>/g, '<LucideCheck size={20} />'],
  [/<lucide\.icons\.FileText size=\{48\} className="mx-auto text-gray-300 mb-3" \/>/g, '<LucideFileText size={48} className="mx-auto text-gray-300 mb-3" />'],
  [/<lucide\.icons\.ChevronDown/g, '<LucideChevronDown'],
  [/<lucide\.icons\.Upload size=\{20\} \/>/g, '<LucideUpload size={20} />'],
  [/<lucide\.icons\.Download size=\{20\} \/>/g, '<LucideDownload size={20} />'],
  [/<lucide\.icons\.Save size=\{20\} \/>/g, '<LucideSave size={20} />'],
  [/<lucide\.icons\.Plus size=\{16\} \/>/g, '<LucidePlus size={16} />'],
];

let count = 0;
for (const [pattern, replacement] of replacements) {
  const before = content;
  content = content.replace(pattern, replacement);
  if (before !== content) {
    count++;
    console.log('Replaced:', pattern.toString().substring(0, 50));
  }
}
console.log(`Total patterns replaced: ${count}`);

// 4. Fix the ItemIcon pattern in menuItems.map - it's already correct from previous fix
// Just make sure it references lucide correctly via window

fs.writeFileSync('public/index.html', content, 'utf8');
console.log('Done! File size:', content.length);
