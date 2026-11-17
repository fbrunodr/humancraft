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
            if t[i][j]!='.' and 0<=r+dr<H and 0<=c+dc<W: T[r+dr][c+dc]=t[i][j]; B[r+dr][c+dc]=b[i][j]
def blob(rows,ch='#',b=None):
    for r,(a,z) in rows.items(): fill(a,z,r,r,ch,b)
def hills(cells,ch='h'):
    for r,c in cells:
        if T[r][c]!='.': T[r][c]=ch
B0=[row[:] for row in B]   # (the tracing's biomes, for what is drawn anew: the nearest land's)

# 1. Cyprus is Europe's (drawn there): not twice.
clear(9,16,44,49)
# 2. Korea: a peninsula five wide.
clear(113,121,49,60)
blob({49:(113,118),50:(113,118),51:(114,118),52:(114,118),53:(114,118),54:(114,118),55:(114,118),56:(115,117)})
hills([(r,117) for r in range(49,56)])
# 3. Japan: drawn whole, an arc four wide from the north-east round to the south-west; Hokkaido off its head, Kyushu off its
#    foot, Sakhalin above. Clear of Korea and of each other.
clear(119,141,26,64)
blob({37:(131,134),38:(130,136),39:(130,136),40:(131,136),41:(132,135)},'#','F')                      # Hokkaido
blob({44:(132,135),45:(132,135),46:(132,135),47:(132,135),48:(131,135),49:(131,134),50:(130,134),51:(129,133),52:(128,132),53:(127,131),54:(126,130),55:(125,129),56:(124,128),57:(123,127)},'#','F')   # Honshu
blob({59:(119,121),60:(118,121),61:(118,121),62:(119,120)},'#','F')                                   # Kyushu
blob({26:(131,132),27:(131,133),28:(131,133),29:(131,133),30:(131,133),31:(131,133),32:(132,133)},'#','T')         # Sakhalin
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

head="; Asia, drawn by hand over a tracing of the real coastlines (scripts/earth.ts REGIONS): '.' sea, '#' land, 'h' hills, '^' mountains.\n; A tile is three characters: every strait is three wide at least. Where Europe's drawing lies, Europe's is kept.\n"
open(D+'asia.txt','w').write(head+'\n'.join(''.join(r) for r in T)+'\n')
open(D+'asia.biomes.txt','w').write("; Asia's biomes, cell for cell with asia.txt, in mapPaint.ts's letters.\n"+'\n'.join(''.join(r) for r in B)+'\n')
