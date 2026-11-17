# The hand corrections to the traced draft of Antarctica -> antarctica.txt, antarctica.biomes.txt.
#   npx tsx scripts/earth.ts --data <dir> --draft antarctica; python3 scripts/earth/antarctica.fix.py; npx tsx scripts/earth.ts --data <dir>
from draw import Picture, moat, inland
p = Picture('antarctica'); T, B = p.T, p.B

moat(p, 4.5)
inland(p)
# All of it under the ice; its lakes (seas shut in by the tracing) land too.
for r in range(p.H):
    for c in range(p.W):
        if T[r][c] == 'o': T[r][c] = '#'
        if T[r][c] in '#h^': B[r][c] = 'I'

p.save("; Antarctica, drawn over a tracing of the real coastline (scripts/earth.ts REGIONS): '.' sea, '#' land, 'h' hills, '^' mountains. All ice sheet.\n",
       "; Antarctica's biomes, cell for cell with antarctica.txt: I, ice sheet.\n")
