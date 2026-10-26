// The look of the key-entry page: the After Effects catalogue window's paper, ink, band and mono receipt, light and dark, with installed fonts only.
export const KEY_PAGE_STYLE = `
@font-face{font-family:"Plex Sans";src:local("IBM Plex Sans"),local("IBMPlexSans-Regular");font-weight:400}
@font-face{font-family:"Plex Sans";src:local("IBM Plex Sans SemiBold"),local("IBMPlexSans-SemiBold");font-weight:600}
@font-face{font-family:"Plex Mono";src:local("IBM Plex Mono Medium"),local("IBMPlexMono-Medium"),local("IBM Plex Mono");font-weight:500}
:root{color-scheme:light dark;--paper:#fbfaf7;--text:#151515;--on-band:#f4f2ec;--on-band-muted:#a9a59b;--muted:#55534d;--faint:#6a675f;--line:#d9d5ca;--green:#1d6a3c;--amber:#855300;--amber-soft:#f3e7cf;--sans:"Plex Sans","IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"Plex Mono","IBM Plex Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{--paper:#1b1b1a;--text:#f4f2ec;--on-band:#151515;--on-band-muted:#55534d;--muted:#c9c5bb;--faint:#a9a59b;--line:#3a3834;--green:#6fbf8a;--amber:#e2ad55;--amber-soft:#2c2518}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--text);font:13px/1.5 var(--sans)}
.band{background:var(--text);color:var(--on-band);padding:0 20px;height:74px;position:relative;display:flex;align-items:flex-end;justify-content:space-between;padding-bottom:14px}
.band::before{content:"";position:absolute;left:20px;top:22px;width:18px;height:1.5px;background:var(--on-band)}
.band .eyebrow{position:absolute;left:46px;top:16px;font:500 9.5px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--on-band-muted)}
.band .eyebrow b{color:var(--on-band);font-weight:500}
.band h1{margin:0;font:600 16px/1.2 var(--sans)}
.band .state{font:500 10px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--on-band-muted)}
main{max-width:560px;margin:0 auto;padding:22px 20px 40px}
p{margin:0 0 16px;color:var(--muted);font-size:13px}
label{display:block;margin:0 0 14px}
label span,summary{display:block;margin:0 0 5px;font:500 10px/1.2 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
input,select{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:2px;background:var(--paper);color:var(--text);font:13px var(--sans)}
input[type=password]{font-family:var(--mono)}
input:focus,select:focus,button:focus-visible{outline:2px solid var(--text);outline-offset:1px}
details{margin:0 0 16px}
summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;margin:0 0 8px}
summary::-webkit-details-marker{display:none}
summary::before{content:"";width:6px;height:6px;border-right:1.5px solid var(--faint);border-bottom:1.5px solid var(--faint);transform:rotate(-45deg);transition:transform .12s}
details[open]>summary::before{transform:rotate(45deg)}
button{margin-top:6px;min-height:40px;padding:12px 28px;border:0;border-radius:2px;background:var(--text);color:var(--on-band);font:500 12px var(--mono);letter-spacing:.12em;text-transform:uppercase;cursor:pointer}
.note{margin:20px 0 0;color:var(--faint);font-size:11px}
.receipt{margin:0 0 16px;padding:10px 12px;border-left:3px solid var(--green);font:500 10px/1.6 var(--mono);letter-spacing:.04em}
.receipt.bad{border-left-color:var(--amber);background:var(--amber-soft);color:var(--amber)}
.receipt .ok{color:var(--green)}
fieldset{border:0;margin:0;padding:0;min-width:0}
fieldset:disabled{opacity:.45}
[hidden]{display:none!important}
button:disabled{opacity:.6;cursor:default}
.warn{padding:8px 12px;margin:0 0 16px;background:var(--amber-soft);color:var(--amber);font-size:12px}
`;
