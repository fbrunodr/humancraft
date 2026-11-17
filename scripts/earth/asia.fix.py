# The hand corrections to the traced draft of Asia -> asia.txt, asia.biomes.txt.
# The draft (asia.draft.txt, .draft.biomes.txt, .marks.json) is the real coastline through the pieces of scripts/earth.ts:
#   npx tsx scripts/earth.ts --data <dir> --draft asia
# then: python3 scripts/earth/asia.fix.py; npx tsx scripts/earth.ts --data <dir>
# Everything is placed by the marks (where real places fall in the tracing), so it follows the tracing if it is laid anew.
from draw import Picture
p = Picture('asia'); T, B, M, at = p.T, p.B, p.M, p.at

# 1. Cyprus is Europe's (drawn there): not twice.
p.channel([at('Limassol')], 3.2)
# 2. The Black Sea is Europe's (drawn there, ending at Batumi): the tracing's own copy of its eastern end, which falls a
#    little east of Europe's, is land here, so the Caucasus joins Russia to Persia.
for r in range(0, M['Batumi'][1] + 3):
    for c in range(0, M['Batumi'][0] + 2):
        if T[r][c] == '.': p.land(c, r, 'h' if r >= M['Batumi'][1] - 10 else '#', p.near(r, c, 's'))
# 3. The Caspian is a lake (the coastline data has it as sea, and as sea the game would join it to the ocean).
for r in range(M['Astrakhan'][1] - 3, M['Tehran'][1] + 1):
    for c in range(M['Baku'][0] - 5, M['Baku'][0] + 14):
        if T[r][c] == '.': T[r][c] = 'o'

# 4. Ceylon an island clear of India.
c0, r0 = M['Colombo']
p.clear(c0 - 1, c0 + 9, M['Jaffna'][1] - 1, r0 + 6)
p.thick([(c0 + 3.5, r0 + 2)], 2.4)
# (And Kathiawar joined to India: the Gulf of Khambhat behind it is narrower than a tile and made it an island.)
for r in range(M['Karachi'][1] + 5, M['Mumbai'][1] - 1):
    for c in range(M['Karachi'][0] + 2, M['Mumbai'][0] + 4):
        if T[r][c] == '.': p.land(c, r)
# 5. The Malay Peninsula down to Singapore; Sumatra moved off it, so the Strait of Malacca is a strait; Java long, clear of Sumatra.
p.clear(M['Aceh'][0] - 7, M['Singapore'][0] + 2, M['Kra'][1] + 1, M['Lampung'][1] + 2)
p.thick([at('Kra'), at('Penang', 1, -1), at('Singapore', -0.5, -1)], 1.7)
p.thick([at('Aceh', -2, 2), at('Medan', 0, 6), at('Lampung', -3, -1)], 2.3)
p.clear(M['Lampung'][0] - 2, M['Surabaya'][0] + 5, M['Lampung'][1] - 1, M['Surabaya'][1] + 4)
p.thick([at('Jakarta', 1.5, 1), at('Surabaya', 3, 1.5)], 1.6)
p.ridge([at('Aceh', -1, 2.5), at('Medan', 0, 6.5), at('Lampung', -3.5, -1)], 0.7, 'h')
p.ridge([at('Jakarta', 2, 1), at('Surabaya', 2, 1.5)], 0.5, 'h')
# 6. Celebes a whole island off Borneo; Luzon and Mindanao; Taiwan and Hainan off the coast.
p.clear(M['Makassar'][0] - 1, M['Manado'][0] + 3, M['Manado'][1] - 3, M['Makassar'][1] + 3)
p.thick([at('Makassar', 1.5, 0), at('Makassar', 2.5, -5), at('Manado', -2, 2), at('Manado', 1, 0.5)], 1.5)
p.clear(M['Manila'][0] - 3, M['Davao'][0] + 4, M['Aparri'][1] - 3, M['Davao'][1] + 4)
p.thick([at('Aparri', 1.5, 1.5), at('Manila', 1.5, 2)], 2.0)
p.thick([at('Davao', -1, 0)], 2.5)
p.clear(M['Taipei'][0] - 2, M['Taipei'][0] + 4, M['Taipei'][1] - 3, M['Kaohsiung'][1] + 2)
p.thick([at('Taipei', 2, -1.5), at('Kaohsiung', 2, -1)], 1.6)
p.clear(M['Haikou'][0] - 1, M['Haikou'][0] + 4, M['Haikou'][1], M['Haikou'][1] + 5)
p.thick([at('Haikou', 1.5, 3)], 1.6)
# 7. Korea a full peninsula with the Yellow Sea beside it.
p.clear(M['Dalian'][0] - 2, M['Busan'][0] + 3, M['Pyongyang'][1], M['Busan'][1] + 5)
p.thick([at('Pyongyang', 1.5, 0), at('Seoul', 1.5, 0.5), at('Busan', -0.5, 0.5)], 2.3)
p.fill(M['Pyongyang'][0] - 1, M['Pyongyang'][0] + 4, M['Pyongyang'][1] - 2, M['Pyongyang'][1])
p.ridge([at('Pyongyang', 3, 0), at('Busan', 0.5, 0)], 0.6, 'h')
# 8. Japan drawn whole and thick: Honshu an arc from the north-east round to the south-west, Hokkaido off its head, Kyushu off
#    its foot, Sakhalin above. Clear of Korea and of each other (and Kamchatka's tip drawn back from Hokkaido).
p.clear(M['Busan'][0] + 1, M['Tokyo'][0] + 10, M['Sapporo'][1] - 9, M['Kagoshima'][1] + 12)
p.clear(M['Lopatka'][0] - 7, M['Lopatka'][0] + 4, M['Lopatka'][1] - 1, M['Lopatka'][1] + 1)
p.thick([at('Sapporo', 2, -4.7)], 3.0, '#', 'F')                                                       # Hokkaido
p.thick([at('Aomori', 2, 2.5), at('Sendai', 0.5, 1), at('Tokyo', 0.5, 0), at('Osaka', 1, 0), at('Hiroshima', 3, 0.5)], 2.6, '#', 'F')   # Honshu
p.thick([at('Fukuoka', 0, 6), at('Kagoshima', 0, 7)], 2.1, '#', 'F')                                   # Kyushu
p.thick([at('Sakhalin', 1.5, -8.5), at('Sakhalin', 1.5, -5.5)], 1.3, '#', 'T')
p.ridge([at('Sendai', 0, 1), at('Tokyo', -0.5, -1), at('Osaka', 2, -0.5)], 0.8, 'h'); p.ridge([at('Tokyo', -2, -1.5)], 1.0)
p.ridge([at('Sapporo', 2, -4.7)], 1.2, 'h'); p.ridge([at('Fukuoka', 0.5, 6.5)], 0.9, 'h')

# 9. The mountains: the tracing's relief is coarse and makes all of inner Asia one high mass. The Himalaya is the great
#    range, an arc hard against India's plain from Kashmir to Assam, the Hindu Kush at its head; Tibet behind it and the
#    ranges to the north (the Tian Shan, the Altai) and Persia's are hills with a ridge of mountains each.
bx, by = M['Batumi']
p.lower(30, 160, 20, M['Kanyakumari'][1], keep=lambda c, r: c <= M['Baku'][0] and r <= by + 3)
p.ridge([at('Srinagar', -3, 1), at('Srinagar', 3, 7), at('Kathmandu', 1, -2), at('Lhasa', 4, 2), at('Lhasa', 9, 0)], 1.5)
p.ridge([at('Kabul', -5, -1), at('Kabul', 2, 1)], 1.0)
p.ridge([at('Tashkent', 2, -1), at('Almaty', 5, -1)], 0.7)
p.ridge([at('Urumqi', 2, -5), at('Urumqi', 8, -2)], 0.7)
p.ridge([at('Basra', -3, -9), at('BandarAbbas', -2, -3)], 0.8)
p.ridge([at('Tehran', -3, -2), at('Tehran', 4, -1)], 0.6)

# 10. Arabia shorter: as traced it reaches too far south beside Africa. From ROW down (below the Strait of Hormuz), the
#     peninsula (all its land west of a line from the Gulf's head to Hormuz) is drawn BY as long (scripts/earth.ts ARABIA says the same, for what is laid
#     against it: Africa's Red Sea shore). What lies beyond the Red Sea from it is Africa's to draw: blank.
ROW, BY, COLS = M['Musandam'][1] + 2, 0.5, 62   # (below the Gulf's mouth only: drawn up from higher, Oman came against Persia's coast)
print('ARABIA', ROW, BY, COLS)
line = lambda r: M['Basra'][0] + 1 + (r - M['Basra'][1]) * 1.0
for r in range(ROW + 1, p.H):
    for c in range(0, COLS):
        if T[r][c] == ' ': T[r][c] = '.'; B[r][c] = '.'
cells = [(r, c) for r in range(ROW + 1, p.H) for c in range(0, COLS) if T[r][c] not in '. o' and c <= line(r)]
keep = [(r, c, T[r][c], B[r][c]) for r, c in cells]
for r, c in cells: T[r][c] = '.'; B[r][c] = '.'
for r, c, t, b in keep:
    rr = ROW + round((r - ROW) * BY)
    T[rr][c] = t; B[rr][c] = b
for r in range(ROW + 1, p.H):
    land = [c for c in range(0, COLS) if T[r][c] not in '. o']
    edge = min(land) - 3 if land else COLS
    for c in range(0, max(0, edge)):
        if T[r][c] in '. ': T[r][c] = ' '; B[r][c] = ' '

p.save("; Asia, drawn by hand over a tracing of the real coastlines (scripts/earth.ts REGIONS): '.' sea, '#' land, 'h' hills, '^' mountains, 'o' lake.\n; A tile is three characters: every strait is three wide at least. Where Europe's drawing lies, Europe's is kept.\n",
       "; Asia's biomes, cell for cell with asia.txt, in mapPaint.ts's letters.\n")
