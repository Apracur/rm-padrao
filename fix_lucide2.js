const fs = require('fs');
let content = fs.readFileSync('public/index.html', 'utf8');

// 1. Remove lucide-react CDN script tag entirely
content = content.replace(
  '<script src="https://unpkg.com/lucide-react@latest/dist/umd/lucide-react.js"></script>',
  ''
);

// 2. Replace the LucideXxx variable declarations and the CDN with SVG helper function
const lucideImportBlock = `    // Lucide React icons - destructured from UMD build
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
    const LucideSettings = window.LucideReact?.Settings || window['lucide-react']?.Settings;`;

const svgIcons = `    // SVG Icon components (inline - no external dependency needed)
    function SvgIcon({ size = 20, className = '', viewBox = '0 0 24 24', children }) {
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width={size}
          height={size}
          viewBox={viewBox}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          {children}
        </svg>
      );
    }
    const LucidePlus = ({ size = 20, className = '' }) => <SvgIcon size={size} className={className}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></SvgIcon>;
    const LucideLogOut = ({ size = 20, className = '' }) => <SvgIcon size={size} className={className}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></SvgIcon>;
    const LucideSearch = ({ size = 20, className = '' }) => <SvgIcon size={size} className={className}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></SvgIcon>;
    const LucidePackage = ({ size = 20, className = '' }) => <SvgIcon size={size} className={className}><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></SvgIcon>;
    const LucideCheck = ({ size = 20, className = '' }) => <SvgIcon size={size} className={className}><polyline points="20 6 9 17 4 12"/></SvgIcon>;
    const LucideFileText = ({ size = 20, className = '' }) => <SvgIcon size={size} className={className}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></SvgIcon>;
    const LucideChevronDown = ({ size = 20, className = '' }) => <SvgIcon size={size} className={className}><polyline points="6 9 12 15 18 9"/></SvgIcon>;
    const LucideUpload = ({ size = 20, className = '' }) => <SvgIcon size={size} className={className}><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></SvgIcon>;
    const LucideDownload = ({ size = 20, className = '' }) => <SvgIcon size={size} className={className}><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></SvgIcon>;
    const LucideSave = ({ size = 20, className = '' }) => <SvgIcon size={size} className={className}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></SvgIcon>;
    const LucideSettings = ({ size = 20, className = '' }) => <SvgIcon size={size} className={className}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></SvgIcon>;`;

content = content.replace(lucideImportBlock, svgIcons);

// 3. In menuItems array, convert icon names to component references
// The Sidebar uses: { id: '...', label: '...', icon: 'Plus' } and then
// const ItemIcon = lucide.icons[item.icon]; -> now icon should be the component directly
// Let's change approach: store components directly in menuItems

content = content.replace(
  `const menuItems = [
        { id: 'nova-requisicao', label: 'Nova Requisição', icon: 'Plus' },
        { id: 'meus-pedidos', label: 'Meus Pedidos', icon: 'FileText' },
      ];

      if (userRole === 'admin') {
        menuItems.push(
          { id: 'estoque', label: 'Estoque', icon: 'Package' },
          { id: 'configuracoes', label: 'Configurações', icon: 'Settings' }
        );
      }`,
  `const menuItems = [
        { id: 'nova-requisicao', label: 'Nova Requisição', icon: LucidePlus },
        { id: 'meus-pedidos', label: 'Meus Pedidos', icon: LucideFileText },
      ];

      if (userRole === 'admin') {
        menuItems.push(
          { id: 'estoque', label: 'Estoque', icon: LucidePackage },
          { id: 'configuracoes', label: 'Configurações', icon: LucideSettings }
        );
      }`
);

// 4. Fix the ItemIcon usage (already correctly uses ItemIcon variable, but now icon IS the component)
content = content.replace(
  `              {menuItems.map((item) => {
                const ItemIcon = lucide.icons[item.icon];
                return (`,
  `              {menuItems.map((item) => {
                const ItemIcon = item.icon;
                return (`
);

fs.writeFileSync('public/index.html', content, 'utf8');
console.log('Done! File size:', content.length);
