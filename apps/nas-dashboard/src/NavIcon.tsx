/** Shared 24px outline grid; decorative icons inherit the navigation state. */
export function NavIcon({name}:{name:string}) {
 const paths:Record<string,React.ReactNode>={
  home:<><path d="M4 4h16v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4Z"/><path d="M8 8h8M8 12h3v4H8zM14 12h2M14 16h2"/></>,
  news:<><rect x="7" y="3" width="14" height="15" rx="2"/><path d="M17 18v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8M11 7h6M11 11h6M11 15h3"/></>,
  mail:<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>,
  usage:<><path d="M4 20V10m5 10V4m5 16v-7m5 7V7M2 20h20"/></>,
  overview:<><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M6 12h3l2-5 3 10 2-5h2"/></>
 };
 return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
