# The hand corrections to the traced draft of Oceania -> oceania.txt, oceania.biomes.txt.
#   npx tsx scripts/earth.ts --data <dir> --draft oceania; python3 scripts/earth/oceania.fix.py; npx tsx scripts/earth.ts --data <dir>
from draw import Picture, moat
p = Picture('oceania'); T, B, M, at = p.T, p.B, p.M, p.at

# 1. A strait kept between it and the Indies (Asia's).
moat(p, 3.2)
# 2. New Guinea a full island, its range down the middle, the Torres Strait under it.
p.clear(M['Sorong'][0] - 2, M['PortMoresby'][0] + 8, M['Sorong'][1] - 3, M['CapeYork'][1] - 4)
p.thick([at('Sorong', 3, 1), at('Jayapura', -1, 2.5), at('PortMoresby', 1, -3)], 2.3, '#', 'J')
p.ridge([at('Sorong', 6, 1.5), at('Jayapura', 0, 2.5), at('PortMoresby', 0, -3)], 0.6)
# 3. Tasmania.
p.clear(M['Hobart'][0] - 3, M['Hobart'][0] + 3, M['Hobart'][1] - 2, M['Hobart'][1] + 4)
p.thick([at('Hobart', 0, 1.3)], 1.7, '#', 'R')
# 4. New Zealand drawn whole (the tracing lays it on its side): the North Island, and the South Island south-west of it
#    across the Cook Strait, the Southern Alps down its spine.
c0, r0 = M['Auckland']
p.clear(c0 - 13, c0 + 8, r0 - 6, p.H - 1)
p.thick([(c0 + 1.5, r0 - 2.5), (c0 - 0.5, r0 + 2.5)], 1.9, '#', 'R')
p.thick([(c0 - 4, r0 + 8), (c0 - 10, r0 + 14)], 1.9, '#', 'R')
p.ridge([(c0 - 5, r0 + 8.5), (c0 - 10, r0 + 13.5)], 0.6)
p.ridge([(c0, r0 + 1)], 0.8, 'h')

p.save("; Australia, New Guinea and New Zealand, drawn by hand over a tracing of the real coastlines (scripts/earth.ts REGIONS): '.' sea, '#' land, 'h' hills, '^' mountains.\n; A tile is three characters: every strait is three wide at least.\n",
       "; Oceania's biomes, cell for cell with oceania.txt, in mapPaint.ts's letters.\n")
