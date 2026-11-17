# The hand corrections to the traced draft of Africa -> africa.txt, africa.biomes.txt.
# The draft (africa.draft.txt, .draft.biomes.txt, .marks.json, .under.txt) is the real coastline through Africa's own laying:
#   npx tsx scripts/earth.ts --data <dir> --draft africa
# then: python3 scripts/earth/africa.fix.py; npx tsx scripts/earth.ts --data <dir>
from draw import Picture, moat
p = Picture('africa'); T, B, M, at = p.T, p.B, p.M, p.at

# 1. A strait kept between Africa and what is drawn already: Gibraltar under Spain, clear water under Sardinia, Sicily and
#    Crete, the Red Sea against Arabia. Only at Suez do they join.
moat(p, 3.2, joins=[(M['Suez'][0], M['Suez'][1], 7)])
# 2. No Lake Nasser (it is the Nile's own, dammed in 1970, and at this scale it stops the river short).
for r in range(M['Aswan'][1] - 8, M['Aswan'][1] + 9):
    for c in range(M['Aswan'][0] - 10, M['Aswan'][0] + 8):
        if p.inside(c, r) and T[r][c] == 'o': p.land(c, r, '#', 'd')
# 3. Madagascar a whole island clear of the coast.
c0, r0 = M['Antananarivo']
p.clear(c0 - 4, c0 + 8, r0 - 10, r0 + 9)
p.thick([(c0 + 3, r0 - 6), (c0 + 1.5, r0 + 4)], 2.3)
p.ridge([(c0 + 3.5, r0 - 5), (c0 + 2, r0 + 3)], 0.6, 'h')

p.save("; Africa, drawn by hand over a tracing of the real coastlines (scripts/earth.ts REGIONS): '.' sea, '#' land, 'h' hills, '^' mountains, 'o' lake.\n; A tile is three characters: every strait is three wide at least. Where Europe's or Asia's drawing lies, theirs is kept.\n",
       "; Africa's biomes, cell for cell with africa.txt, in mapPaint.ts's letters.\n")
