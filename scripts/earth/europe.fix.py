# The hand corrections to the traced draft of Europe -> europe.txt, europe.biomes.txt.
# The draft (europe.draft.txt, europe.draft.biomes.txt) is the real coastline at 2.2 times life size:
#   EARTH_TRIAL=2.2 npx tsx scripts/earth.ts --data <dir> --draft europe,100,92,1
# then: python3 scripts/earth/europe.fix.py; npx tsx scripts/earth.ts --data <dir>
import os
D=os.path.dirname(os.path.abspath(__file__))+'/'
T=[list(l) for l in open(D+'europe.draft.txt').read().split('\n') if l]
B=[list(l) for l in open(D+'europe.draft.biomes.txt').read().split('\n') if l]
H,W=len(T),len(T[0])
def clear(c0,c1,r0,r1):
    for r in range(max(0,r0),min(H,r1+1)):
        for c in range(max(0,c0),min(W,c1+1)): T[r][c]='.'; B[r][c]='.'
def fill(c0,c1,r0,r1,ch='#',b='m'):
    for r in range(r0,r1+1):
        for c in range(c0,c1+1): T[r][c]=ch; B[r][c]=b
def move(c0,c1,r0,r1,dc,dr):
    t=[[T[r][c] for c in range(c0,c1+1)] for r in range(r0,r1+1)]; b=[[B[r][c] for c in range(c0,c1+1)] for r in range(r0,r1+1)]
    clear(c0,c1,r0,r1)
    for i,r in enumerate(range(r0,r1+1)):
        for j,c in enumerate(range(c0,c1+1)):
            if t[i][j]!='.' and 0<=r+dr<H and 0<=c+dc<W: T[r+dr][c+dc]=t[i][j]; B[r+dr][c+dc]=b[i][j]
def blob(rows,ch='#',b='m'):   # rows: {row: (c0,c1)}
    for r,(a,z) in rows.items(): fill(a,z,r,r,ch,b)

# 1. The British Isles: north by three and west by one, so the Channel is a channel; the North Channel opened.
move(15,34,18,38,-1,-3)
clear(23,25,22,26)
move(14,23,20,30,-2,0)                                 # (Ireland two further west: on the smallest globe the Irish Sea closed)
# 2. The Strait of Gibraltar; and no Africa yet (it is drawn with Africa): everything south of the sea's middle goes.
clear(0,40,67,69)
clear(0,W-1,69,H-1)
clear(86,W-1,66,H-1)                                   # the Levant likewise (Asia's)
# 3. The Balearics.
blob({62:(30,32),63:(30,33),64:(31,33)})
# 4. Corsica and Sardinia: one long island clear of both shores.
clear(38,45,55,68)
blob({58:(38,40),59:(38,41),60:(38,41),61:(39,41),62:(38,41),63:(38,41),64:(38,41),65:(39,40)})
for r in (59,60,63): T[r][39]='h'
# 5. Italy's toe drawn back and Sicily set clear of it.
clear(50,57,64,68)
clear(42,56,66,68)
blob({67:(47,51),68:(46,52),69:(47,51)})
T[68][50]='h'
# 7. The Peloponnese whole; Crete.
blob({65:(61,65),66:(61,65),67:(61,65),68:(62,64)})
for r in (66,67): T[r][63]='h'
clear(66,75,69,75)
blob({72:(67,72),73:(66,73),74:(68,72)})
for c in (68,69,70): T[73][c]='h'
# 8. The Bosporus, the Sea of Marmara, the Dardanelles: the Black Sea opens to the Aegean.
clear(72,75,55,61)
clear(69,75,60,62)
clear(67,71,61,64)
# 9. Cyprus.
blob({70:(82,85),71:(81,86),72:(82,85)})
# 10. Denmark: the Skagerrak and the Kattegat opened, Jutland a peninsula three wide.
clear(39,47,23,25)
clear(42,48,26,32)
blob({26:(43,45),27:(42,45),28:(42,45),29:(42,45),30:(42,45),31:(42,45),32:(42,45)},'#','F')

# 12. Italy redrawn: a boot, long and narrow, running south-east, its heel and toe, the Adriatic five wide beside it;
#     Sicily off the toe (there is no Africa to crowd it).
coast={54:53,55:53,56:55,57:57,58:58,59:59,60:59,61:59,62:59,63:60,64:61,65:61,66:61,67:61,68:61,69:61}
for r,c in coast.items(): clear(42,c-1,r,r)
clear(42,56,66,76)
clear(48,50,51,51); clear(48,52,52,53); clear(49,53,54,55)
boot={54:(44,47),55:(44,48),56:(45,49),57:(45,49),58:(46,50),59:(47,51),60:(47,51),61:(48,52),62:(49,53),63:(50,56),64:(51,57),65:(51,54),66:(50,54),67:(48,53),68:(47,51),69:(46,49)}
blob(boot)
fill(56,57,65,65)
for r,(a,z) in boot.items():
    if 55<=r<=66: T[r][(a+z)//2]='h'; T[r][(a+z)//2+1]='h'          # the Apennines down its middle
blob({73:(43,49),74:(42,49),75:(43,48),76:(44,46)})
T[74][46]='h'; T[74][47]='^'                                         # Etna
# 13. Scotland fuller.
blob({15:(26,28),16:(25,29),17:(24,29),18:(24,30),19:(25,30),20:(25,30),21:(25,29),22:(26,29)},'#','F')
for r in range(16,22):
    for c in range(25,28): T[r][c]='h'

# 11. The ranges the tracing's relief is too coarse for: the Alps, the Pyrenees, the Caucasus (mountains where there is land).
def ridge(cells):
    for c0,c1,r in cells:
        for c in range(c0,c1+1):
            if T[r][c] in '#h': T[r][c]='^'
ridge([(38,41,51),(39,44,50),(41,47,49),(44,50,48),(47,51,47)])          # the Alps
ridge([(22,30,55),(23,29,56)])                                            # the Pyrenees
ridge([(86,99,49),(88,99,50),(91,99,51)])                                 # the Caucasus

head="; Europe and the Mediterranean's northern shores, drawn by hand over a tracing of the real coastlines at 2.2 times life size\n; (scripts/earth.ts PATCHES): '.' sea, '#' land, 'h' hills, '^' mountains. A tile is three characters: every strait is three wide at least.\n"
open(D+'europe.txt','w').write(head+'\n'.join(''.join(r) for r in T)+'\n')
open(D+'europe.biomes.txt','w').write("; Europe's biomes, cell for cell with europe.txt, in mapPaint.ts's letters (t tundra, T taiga, F temperate forest, p prairie, s steppe, m mediterranean, d hot desert...).\n"+'\n'.join(''.join(r) for r in B)+'\n')
print('\n'.join(''.join(r) for r in T[14:76]))
