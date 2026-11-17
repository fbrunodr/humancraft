# The hand corrections to the traced draft of Asia -> asia.txt, asia.biomes.txt.
# The draft (asia.draft.txt, asia.draft.biomes.txt) is the real coastline through the pieces of scripts/earth.ts
# (easing from Europe's size down to life size and under):
#   npx tsx scripts/earth.ts --data <dir> --draft asia
# then: python3 scripts/earth/asia.fix.py; npx tsx scripts/earth.ts --data <dir>
import os
D=os.path.dirname(os.path.abspath(__file__))+'/'
T=[list(l) for l in open(D+'asia.draft.txt').read().split('\n') if l]
B=[list(l) for l in open(D+'asia.draft.biomes.txt').read().split('\n') if l]
H,W=len(T),len(T[0])
def clear(c0,c1,r0,r1):
    for r in range(max(0,r0),min(H,r1+1)):
        for c in range(max(0,c0),min(W,c1+1)):
            if T[r][c]!=' ': T[r][c]='.'; B[r][c]='.'
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

# 1. Cyprus is Europe's (drawn there): not twice.
clear(9,16,44,49)
# 2. Korea: a peninsula five wide.
clear(110,121,51,60)                                   # (and the Yellow Sea opened beside it)
blob({51:(113,119),52:(115,119),53:(115,119),54:(115,119),55:(115,119),56:(116,118)})
hills([(r,118) for r in range(51,56)])
# 3. Japan: drawn whole, an arc four wide from the north-east round to the south-west; Hokkaido off its head, Kyushu off its
#    foot, Sakhalin above. Clear of Korea and of each other.
clear(124,141,33,64); clear(119,123,45,64)             # (Kamchatka's tip with it: it came down onto Hokkaido)
blob({37:(131,134),38:(130,136),39:(130,136),40:(131,136),41:(132,135)},'#','F')                      # Hokkaido
blob({44:(132,135),45:(132,135),46:(132,135),47:(132,135),48:(131,135),49:(131,134),50:(130,134),51:(129,133),52:(128,132),53:(127,131),54:(126,130),55:(125,129),56:(124,128),57:(123,127)},'#','F')   # Honshu
blob({59:(119,121),60:(118,121),61:(118,121),62:(119,120)},'#','F')                                   # Kyushu
blob({29:(122,123),30:(122,124),31:(122,124),32:(122,124),33:(122,124),34:(122,124),35:(123,124)},'#','T')         # Sakhalin
hills([(r,c) for r,c in ((45,133),(46,133),(47,133),(48,133),(49,132),(50,132),(53,129),(54,128),(55,127),(56,126))]); hills([(51,131),(52,130)],'^'); hills([(39,132),(39,133),(60,119)])
# 4. Taiwan and Hainan.
clear(112,117,66,72); blob({68:(114,116),69:(114,116),70:(114,116),71:(115,116)}); hills([(69,115),(70,115)])
clear(101,107,75,79); blob({76:(104,106),77:(104,106),78:(104,105)})
# 5. The Malay Peninsula three wide down to Singapore; Sumatra moved off it, so the Strait of Malacca is a strait; Java long, clear of Sumatra.
move(86,100,89,104,-3,1)
clear(91,100,82,94)
blob({82:(92,94),83:(92,94),84:(92,94),85:(92,94),86:(93,95),87:(93,96),88:(94,97),89:(95,98),90:(95,99),91:(96,99),92:(96,99),93:(97,99)})
hills([(r,c) for r,c in ((88,95),(89,96),(90,97),(91,97))])
clear(96,113,103,108)
blob({104:(99,106),105:(99,110),106:(100,112),107:(104,112)}); hills([(105,c) for c in range(101,109)])
# 6. Celebes a whole island off Borneo; Luzon and Mindanao.
clear(117,126,96,104)
blob({97:(121,124),98:(120,124),99:(120,123),100:(120,122),101:(120,123),102:(121,124),103:(122,124)}); hills([(99,121),(100,121),(101,121)])
clear(116,129,71,91)
blob({74:(118,120),75:(118,121),76:(118,121),77:(118,121),78:(119,121),79:(119,121),80:(119,120)}); hills([(76,119),(77,119)])
blob({84:(123,126),85:(122,127),86:(122,127),87:(122,127),88:(123,126)}); hills([(86,124),(86,125)])
# 7. Ceylon a little larger.
clear(72,78,90,95)
blob({91:(74,76),92:(73,76),93:(73,76),94:(74,75)})

# 8. The mountains: the tracing's relief is too coarse and made all of inner Asia one high mass. The Himalaya is the great
#    range, an arc three thick hard against India's plain from Kashmir to Assam, the Hindu Kush at its head; Tibet behind
#    it and the ranges to the north (the Tian Shan, the Altai) and Persia's are hills with a ridge of mountains each.
for r in range(26,72):
    for c in range(28,108):
        if T[r][c]=='^' and not (35<=c<=41 and 36<=r<=45): T[r][c]='h'
def ridge(pts,thick=1):
    for c,r in pts:
        for dr in range(-thick,thick+1):
            if T[r+dr][c] in '#h': T[r+dr][c]='^'
def line(a,b):
    (c0,r0),(c1,r1)=a,b; n=max(abs(c1-c0),abs(r1-r0),1)
    return [(round(c0+(c1-c0)*i/n),round(r0+(r1-r0)*i/n)) for i in range(n+1)]
ridge(line((68,58),(74,62))+line((74,62),(80,67))+line((80,67),(90,67))+line((90,67),(94,65)))     # the Himalaya
ridge(line((61,55),(68,57)))                                                                         # the Hindu Kush
ridge(line((67,47),(80,44)),0); ridge(line((68,48),(79,45)),0)                                       # the Tian Shan
ridge(line((83,33),(89,36)),0)                                                                       # the Altai
ridge(line((30,51),(42,62)),0); ridge(line((31,51),(43,62)),0)                                       # the Zagros
ridge(line((36,49),(42,50)),0)                                                                       # the Elburz

# 9. The Black Sea is Europe's (drawn there, ending at Batumi): the tracing's own copy of its eastern end, which fell a
#    little east of Europe's, is land here (the Kuban, Georgia, Armenia), so the sea ends where Europe drew it and the
#    Caucasus joins Russia to Persia. The Caspian, further east, stays (a lake, 'o': as sea the game would join it to the ocean).
for r in range(10,43):
    for c in range(0,37):
        if T[r][c]=='.': T[r][c]='h' if r>=30 else '#'; B[r][c]=near(r,c,'s')

# 10. The Caspian is a lake (the coastline data has it as sea).
for r in range(24,54):
    for c in range(37,64):
        if T[r][c]=='.': T[r][c]='o'

# 11. Arabia shorter: as traced (half as large again as life, hung from the Levant) it reached too far south beside Africa.
#     From row 58 down, the peninsula (all its land west of a line from the Gulf's head to Hormuz) is drawn seven tenths
#     as long (scripts/earth.ts ARABIA says the same, for what is laid against it: Africa's Red Sea shore).
ROW,BY=58,0.7
for r in range(ROW+1,H):
    for c in range(0,56):
        if T[r][c]==' ': T[r][c]='.'; B[r][c]='.'   # (the blanks are set again below, for Arabia as drawn)
cells=[(r,c) for r in range(ROW+1,H) for c in range(0,56) if T[r][c] not in '. o' and c <= 35+(r-63)*1.25]
keep=[(r,c,T[r][c],B[r][c]) for r,c in cells]
for r,c in cells: T[r][c]='.'; B[r][c]='.'
for r,c,t,b in keep:
    rr=ROW+round((r-ROW)*BY)
    T[rr][c]=t; B[rr][c]=b

# (And what lies beyond the Red Sea from it is Africa's to draw: blank from three characters off Arabia's western shore,
# and everything west of the Gulf below its tip.)
for r in range(ROW+1,H):
    land=[c for c in range(0,56) if T[r][c] not in '. o']
    edge=min(land)-3 if land else 56
    for c in range(0,max(0,edge)):
        if T[r][c] in '. ': T[r][c]=' '; B[r][c]=' '
# (And the Strait of Hormuz kept open: drawn up, Oman's point came against Persia's coast.)
clear(43,50,67,70); clear(49,55,70,72)

head="; Asia, drawn by hand over a tracing of the real coastlines (scripts/earth.ts REGIONS): '.' sea, '#' land, 'h' hills, '^' mountains.\n; A tile is three characters: every strait is three wide at least. Where Europe's drawing lies, Europe's is kept.\n"
open(D+'asia.txt','w').write(head+'\n'.join(''.join(r) for r in T)+'\n')
open(D+'asia.biomes.txt','w').write("; Asia's biomes, cell for cell with asia.txt, in mapPaint.ts's letters.\n"+'\n'.join(''.join(r) for r in B)+'\n')
