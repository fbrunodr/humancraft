# The hand corrections to the traced draft of Africa -> africa.txt, africa.biomes.txt.
# The draft (africa.draft.txt, africa.draft.biomes.txt) is the real coastline through Africa's own laying (scripts/earth.ts REGIONS):
#   npx tsx scripts/earth.ts --data <dir> --draft africa
# then: python3 scripts/earth/africa.fix.py; npx tsx scripts/earth.ts --data <dir>
import os
D=os.path.dirname(os.path.abspath(__file__))+'/'
T=[list(l) for l in open(D+'africa.draft.txt').read().split('\n') if l]
B=[list(l) for l in open(D+'africa.draft.biomes.txt').read().split('\n') if l]
H,W=len(T),len(T[0])
def clear(c0,c1,r0,r1):
    for r in range(max(0,r0),min(H,r1+1)):
        for c in range(max(0,c0),min(W,c1+1)): T[r][c]='.'; B[r][c]='.'
def near(r,c,d):
    for k in range(1,12):
        for dr in range(-k,k+1):
            for dc in range(-k,k+1):
                rr,cc=r+dr,c+dc
                if 0<=rr<H and 0<=cc<W and B0[rr][cc] not in '. ': return B0[rr][cc]
    return d
def fill(c0,c1,r0,r1,ch='#',b=None):
    for r in range(r0,r1+1):
        for c in range(c0,c1+1): T[r][c]=ch; B[r][c]=b or near(r,c,'F')
def move(c0,c1,r0,r1,dc,dr):
    t=[[T[r][c] for c in range(c0,c1+1)] for r in range(r0,r1+1)]; b=[[B[r][c] for c in range(c0,c1+1)] for r in range(r0,r1+1)]
    clear(c0,c1,r0,r1)
    for i,r in enumerate(range(r0,r1+1)):
        for j,c in enumerate(range(c0,c1+1)):
            if t[i][j] not in '. ' and 0<=r+dr<H and 0<=c+dc<W: T[r+dr][c+dc]=t[i][j]; B[r+dr][c+dc]=b[i][j]
def blob(rows,ch='#',b=None):
    for r,(a,z) in rows.items(): fill(a,z,r,r,ch,b)
def hills(cells,ch='h'):
    for r,c in cells:
        if T[r][c]!='.': T[r][c]=ch
B0=[row[:] for row in B]   # (the tracing's biomes, for what is drawn anew: the nearest land's)

# 1. The Barbary coast drawn back from Europe's islands: clear water under Sardinia and three rows of it under Sicily.
for r in range(0,40):
    for c in range(46,W):
        if T[r][c]!='.': T[r][c]='.'; B[r][c]='.'
clear(57,70,0,45)
clear(18,47,0,42)                                      # (and the Strait of Gibraltar three wide under Spain)
# 2. East Africa made whole: the Red Sea's shore is laid as Asia lays Arabia and the inland as the rest of Africa, and the
#    land tore between them. Land from the Horn's root down a straight coast from Mogadishu to Mombasa; sea below it.
for c in range(84,100):
    edge=int(80+(c-85)*0.5)
    for r in range(72,edge+1):
        if T[r][c]=='.': T[r][c]='#'; B[r][c]=near(r,c,'v')
    for r in range(edge+1,90):
        if c>=86 and T[r][c]!='.': T[r][c]='.'; B[r][c]='.'
# 3. Madagascar clear of the coast.
move(86,95,89,99,3,0)

head="; Africa, drawn by hand over a tracing of the real coastlines (scripts/earth.ts REGIONS): '.' sea, '#' land, 'h' hills, '^' mountains, 'o' lake.\n; A tile is three characters: every strait is three wide at least. Where Europe's or Asia's drawing lies, theirs is kept.\n"
open(D+'africa.txt','w').write(head+'\n'.join(''.join(r) for r in T)+'\n')
open(D+'africa.biomes.txt','w').write("; Africa's biomes, cell for cell with africa.txt, in mapPaint.ts's letters.\n"+'\n'.join(''.join(r) for r in B)+'\n')
