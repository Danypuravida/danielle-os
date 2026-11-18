from pathlib import Path
import re,colorsys,os
os.chdir(Path(__file__).resolve().parents[1])
# Mirror only color declarations; layouts and the original light palette stay unchanged.
SOURCES=['career-portfolio.css','learning-bank.css','focus-workspace.css','native-tasks.css','development-workspaces.css','clean-theme.css','workspace-theme.css']
color_re=re.compile(r'#[0-9a-fA-F]{3,8}\b|\bwhite\b|\bblack\b')
allowed={'color','background','background-color','background-image','border','border-color','border-top','border-top-color','border-right','border-right-color','border-bottom','border-bottom-color','border-left','border-left-color','outline','outline-color','box-shadow','text-shadow','fill','stroke','caret-color','accent-color','text-decoration-color','scrollbar-color'}
def rgba(token):
 token={'white':'#ffffff','black':'#000000'}.get(token,token)[1:]
 if len(token) in (3,4):token=''.join(c*2 for c in token)
 if len(token) not in (6,8):return None
 return [int(token[i:i+2],16)/255 for i in (0,2,4)],token[6:]
def change(token,prop):
 parsed=rgba(token)
 if not parsed:return token
 rgb,alpha=parsed;h,l,s=colorsys.rgb_to_hls(*rgb);hue=h*360
 def out(hex):return hex+alpha
 if prop in ('box-shadow','text-shadow'):
  return out('#000000' if prop=='box-shadow' else '#b9c5b6')
 if prop=='scrollbar-color':return out('#61726c')
 if prop.startswith('border') or prop.startswith('outline'):
  return out('#3a4948' if l>.65 or l<.25 else '#698062')
 if prop in ('background','background-color','background-image'):
  if l<.2:return token
  if l>.96:return out('#192127')
  if l>.72:
   if s>.35 and (hue<35 or hue>335):return out('#392826')
   if s>.35 and 35<=hue<65:return out('#383224')
   if s>.30 and 65<=hue<175:return out('#24342b')
   return out('#192127' if l>.95 else '#232e32' if l>.86 else '#2b3739')
  r,g,b=colorsys.hls_to_rgb(h,.27,min(.36,max(.18,s)))
  return out('#'+''.join(f'{round(c*255):02x}' for c in (r,g,b)))
 if l>.91:return out('#f1f5ee')
 if s>.29:
  r,g,b=colorsys.hls_to_rgb(h,.76,min(.70,max(.28,s)))
  return out('#'+''.join(f'{round(c*255):02x}' for c in (r,g,b)))
 return out('#e5ebe8' if l<.35 else '#b8c4b4')
def custom(prop):
 if prop.endswith(('-ink','-text')):return '#e5ebe8'
 if prop.endswith('-muted'):return '#aeb9b0'
 if prop.endswith('-line'):return '#3a4948'
 if prop.endswith(('-paper','-card')):return '#192127'
 if prop.endswith('-heading'):return '#e5ebe8'
 if prop.endswith('-soft'):return '#26352b'
 if prop.endswith('-sage'):return '#577146'
 return None
rules=[]
for filename in SOURCES:
 css=re.sub(r'/\*.*?\*/','',Path(filename).read_text(),flags=re.S)
 for match in re.finditer(r'([^{}]+)\{([^{}]*)\}',css):
  selectors=match[1].strip()
  if selectors.startswith('@') or re.search(r'(^|,)\s*(?:\d+%|from|to)\s*(,|$)',selectors):continue
  declarations=[]
  for decl in match[2].split(';'):
   if ':' not in decl:continue
   prop,value=decl.split(':',1);prop=prop.strip();value=value.strip()
   if prop.startswith('--'):
    converted=custom(prop)
    if converted:declarations.append(prop+':'+converted)
   elif prop=='color-scheme':declarations.append('color-scheme:dark')
   elif prop in allowed and color_re.search(value):
    declarations.append(prop+':'+color_re.sub(lambda m:change(m[0],prop),value))
  if not declarations:continue
  prefixed=[]
  for selector in selectors.split(','):
   selector=selector.strip()
   if selector==':root':continue
   prefixed.append('html[data-theme="dark"]'+('' if selector=='html' else ' '+selector))
  if prefixed:rules.append(','.join(prefixed)+'{'+ ';'.join(declarations)+'}')
header='''/* Danielle OS · appearance controls and a dark palette for every native workspace. */
.appearance-control{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px;color:var(--muted);font-size:12px}.appearance-control label{margin:0;font-weight:500}.appearance-control select{width:auto;max-width:155px;min-height:42px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--text);font:inherit;cursor:pointer}.appearance-status{font-size:12px;color:var(--muted);margin:8px 0}.appearance-status[hidden]{display:none!important}
html[data-theme="dark"]{color-scheme:dark;--bg:#11171c;--panel:#192127;--panel2:#242f35;--text:#e5ebe8;--muted:#aeb9b0;--line:#3a4948;--accent:#b2c99f;--good:#add6b1;--warn:#efc88b;--bad:#ffaaa0;--paper:#192127;--tint:#232e32;--sage-soft:#26392c;--danger-soft:#392826;--warning-soft:#383224;--shadow:0 3px 16px #0003;--workspace-paper:#192127;--workspace-card:#1c272c;--workspace-heading:#e5ebe8}
'''
footer='''
html[data-theme="dark"] input,html[data-theme="dark"] select,html[data-theme="dark"] textarea{color-scheme:dark}
html[data-theme="dark"] .cp-dialog,html[data-theme="dark"] .lb-dialog,html[data-theme="dark"] .nt-dialog,html[data-theme="dark"] .dw-dialog{background:var(--panel);color:var(--text);border-color:var(--line)}
html[data-theme="dark"] .finance-bar-fill{background:linear-gradient(90deg,#8fac78,#80aa90)}
html[data-theme="dark"] .bar i,html[data-theme="dark"] .growth-progress i,html[data-theme="dark"] .progressbar>span,html[data-theme="dark"] .finance-progress i{background:#a3be8d}
html[data-theme="dark"]{scrollbar-color:#61726c var(--bg)}
html[data-theme="dark"] #centralFrame{background:var(--panel)!important}
html[data-theme="dark"] .appearance-control select{background:var(--panel);color:var(--text)}
'''
Path('appearance.css').write_text(header+'\n'.join(rules)+footer)
print('Dark color rules:',len(rules))
