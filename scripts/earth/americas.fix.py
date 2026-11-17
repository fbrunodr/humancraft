# The hand corrections to the traced draft of the Americas -> americas.txt, americas.biomes.txt.
#   npx tsx scripts/earth.ts --data <dir> --draft americas; python3 scripts/earth/americas.fix.py; npx tsx scripts/earth.ts --data <dir>
from draw import Picture, moat, inland
p = Picture('americas'); T, B, M, at = p.T, p.B, p.M, p.at

# 1. A strait kept between the Americas and what is drawn already (the Bering Strait; Greenland off Iceland).
moat(p, 3.2)
# 2. Central America whole, from Mexico down the isthmus to Colombia.
p.thick([at('Guatemala', 0, -1), at('Managua', 0, -1), at('Managua', 5, 2.5), at('Panama', 0, 0), at('Cartagena', -1, 1.5)], 1.4, '#', 'J')
p.ridge([at('Guatemala', 0, -1), at('Managua', 0, -1)], 0.5, 'h')
# 3. The Caribbean: the sea cleared, then its islands set down whole and clear of each other and of both shores.
p.clear(M['Cancun'][0] + 3, M['SanJuan'][0] + 8, M['Havana'][1] - 2, M['Cartagena'][1] - 4)
p.thick([at('Jacksonville', 1, 1), at('Miami', -1, -0.5)], 1.7, '#', 'F')                               # Florida
p.thick([at('Havana', 0.5, 1.5), at('Santiago de Cuba', 0, 1)], 1.3, '#', 'v')                          # Cuba
p.thick([at('Kingston', -2.5, 3.5)], 1.7, '#', 'J')                                                         # Jamaica
p.thick([at('PortAuPrince', 1, 1.5), at('SantoDomingo', 2, 1)], 1.6, '#', 'J')                          # Hispaniola
p.thick([at('SanJuan', 4.5, 0.5)], 1.6, '#', 'J')                                                       # Puerto Rico
p.ridge([at('PortAuPrince', 2, 1.5)], 0.6, 'h')
# 4. Baja California a peninsula, the Gulf of California three wide behind it.
c0, r0 = M['CaboSanLucas']
p.clear(c0 - 4, M['Mazatlan'][0] - 1, M['LosAngeles'][1] + 5, r0 + 1)
p.thick([at('LosAngeles', 2.5, 4), (c0 - 1, r0)], 1.0, '#', 'd')

# 5. Hudson Bay opened to the Atlantic by its strait; the smaller seas shut in among the Arctic islands are lakes.
p.channel([at('Churchill', 6, -3), at('Iqaluit', -4, -3), at('Iqaluit', 5, 2), at('Iqaluit', 10, 4)], 1.7)
inland(p, 150)

# 6. Hawaii, out in the Pacific south-west of California: two islands' worth, so it is there to be found and settled.
p.thick([at('SanFrancisco', -38, 19), at('SanFrancisco', -34.5, 21.5)], 1.5, '#', 'J')
p.ridge([at('SanFrancisco', -35, 21)], 0.7)

p.save("; The Americas and Greenland, drawn by hand over a tracing of the real coastlines (scripts/earth.ts REGIONS): '.' sea, '#' land, 'h' hills, '^' mountains, 'o' lake.\n; A tile is three characters: every strait is three wide at least.\n",
       "; The Americas' biomes, cell for cell with americas.txt, in mapPaint.ts's letters.\n")
