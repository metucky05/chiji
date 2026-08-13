/* world.js — 体素世界：地形生成、纹理图集、分块网格、方块破坏/放置、体素射线 */
(function () {
  "use strict";
  var Chiji = (window.Chiji = window.Chiji || {});

  // ---------------- 方块定义 ----------------
  var BLOCK = {
    AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, WOOD: 4, LEAVES: 5, PLANK: 6, SAND: 7, BRICK: 8,
  };
  // 方块耐久（子弹/拳头打掉所需伤害值）
  var BLOCK_HP = { 1: 30, 2: 30, 3: 90, 4: 60, 5: 10, 6: 45, 7: 25, 8: 90 };

  // ---------------- 简易确定性噪声 ----------------
  function makeRng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  function makeNoise2D(seed) {
    var rng = makeRng(seed);
    var perm = [];
    for (var i = 0; i < 256; i++) perm[i] = i;
    for (i = 255; i > 0; i--) {
      var j = (rng() * (i + 1)) | 0;
      var t = perm[i]; perm[i] = perm[j]; perm[j] = t;
    }
    function hash(x, y) { return perm[(perm[x & 255] + y) & 255] / 255; }
    function smooth(t) { return t * t * (3 - 2 * t); }
    return function (x, y) {
      var xi = Math.floor(x), yi = Math.floor(y);
      var xf = x - xi, yf = y - yi;
      var a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
      var u = smooth(xf), v = smooth(yf);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
  }

  // ---------------- 纹理图集（canvas 程序化生成，16px 像素风） ----------------
  // 图块顺序: 0草顶 1草侧 2泥土 3石头 4木侧 5木顶 6树叶 7木板 8沙子 9砖块
  function buildAtlas() {
    var TILE = 16, COUNT = 10;
    var cv = document.createElement("canvas");
    cv.width = TILE * COUNT; cv.height = TILE;
    var g = cv.getContext("2d");
    var rng = makeRng(20260612);
    function fillTile(idx, base, jitter, fn) {
      for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) {
        var f = 1 - jitter / 2 + rng() * jitter;
        var r = Math.min(255, base[0] * f) | 0, gg = Math.min(255, base[1] * f) | 0, b = Math.min(255, base[2] * f) | 0;
        if (fn) { var o = fn(x, y, [r, gg, b]); r = o[0]; gg = o[1]; b = o[2]; }
        g.fillStyle = "rgb(" + r + "," + gg + "," + b + ")";
        g.fillRect(idx * TILE + x, y, 1, 1);
      }
    }
    fillTile(0, [106, 170, 64], 0.25);                       // 草顶
    fillTile(1, [134, 96, 67], 0.2, function (x, y, c) {     // 草侧：上沿带草色
      return y < 3 + ((x * 7) % 3) ? [98, 160, 60] : c;
    });
    fillTile(2, [134, 96, 67], 0.25);                        // 泥土
    fillTile(3, [125, 125, 125], 0.18);                      // 石头
    fillTile(4, [102, 81, 50], 0.15, function (x, y, c) {    // 木侧：竖纹
      return x % 4 === 0 ? [c[0] * 0.78 | 0, c[1] * 0.78 | 0, c[2] * 0.78 | 0] : c;
    });
    fillTile(5, [168, 137, 88], 0.12, function (x, y, c) {   // 木顶：年轮
      var dx = x - 8, dy = y - 8, d = Math.sqrt(dx * dx + dy * dy) | 0;
      return d % 3 === 0 ? [c[0] * 0.8 | 0, c[1] * 0.8 | 0, c[2] * 0.8 | 0] : c;
    });
    fillTile(6, [58, 126, 34], 0.35);                        // 树叶
    fillTile(7, [178, 142, 90], 0.12, function (x, y, c) {   // 木板：横板缝
      return y % 4 === 3 ? [c[0] * 0.7 | 0, c[1] * 0.7 | 0, c[2] * 0.7 | 0] : c;
    });
    fillTile(8, [219, 207, 160], 0.15);                      // 沙子
    fillTile(9, [148, 88, 76], 0.12, function (x, y, c) {    // 砖块
      var row = (y >> 2) % 2, bx = (x + row * 4) % 8;
      return (y % 4 === 3 || bx === 7) ? [200, 195, 190] : c;
    });
    var tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return { texture: tex, tiles: COUNT };
  }
  // 方块 → 各面图块索引 [top, bottom, side]
  var FACE_TILES = {
    1: [0, 2, 1], 2: [2, 2, 2], 3: [3, 3, 3], 4: [5, 5, 4],
    5: [6, 6, 6], 6: [7, 7, 7], 7: [8, 8, 8], 8: [9, 9, 9],
  };

  // ---------------- 世界本体 ----------------
  var SIZE = 128, HEIGHT = 48, CHUNK = 16;
  var data = null;            // Uint8Array
  var damage = {};            // "x,y,z" -> 已受伤害
  var chunkMeshes = {};       // "cx,cz" -> Mesh
  var scene = null, material = null, noise = null, rng = null;
  var lootSpots = [];         // 推荐刷物资点
  var houseSpots = [];

  function idx(x, y, z) { return (y * SIZE + z) * SIZE + x; }
  function inBounds(x, y, z) { return x >= 0 && x < SIZE && z >= 0 && z < SIZE && y >= 0 && y < HEIGHT; }
  function getBlock(x, y, z) {
    if (!inBounds(x, y, z)) return y < 0 ? BLOCK.STONE : BLOCK.AIR; // 地图边界外：底部视为实心
    return data[idx(x, y, z)];
  }
  function solidAt(x, y, z) { return getBlock(x, y, z) !== BLOCK.AIR; }

  function surfaceY(x, z) {
    x |= 0; z |= 0;
    for (var y = HEIGHT - 1; y >= 0; y--) if (getBlock(x, y, z) !== BLOCK.AIR) return y + 1;
    return 1;
  }

  // ---------------- 地形生成 ----------------
  function generate(seed) {
    data = new Uint8Array(SIZE * SIZE * HEIGHT);
    noise = makeNoise2D(seed);
    rng = makeRng(seed ^ 0x9e3779b9);
    var n2 = makeNoise2D(seed + 7777);

    for (var x = 0; x < SIZE; x++) {
      for (var z = 0; z < SIZE; z++) {
        var nx = x / SIZE, nz = z / SIZE;
        var h = 6
          + noise(nx * 6, nz * 6) * 10
          + noise(nx * 18, nz * 18) * 4
          + Math.pow(n2(nx * 3, nz * 3), 2) * 14;
        // 地图边缘压低，形成"岛"感
        var ex = Math.min(x, SIZE - 1 - x) / (SIZE / 2), ez = Math.min(z, SIZE - 1 - z) / (SIZE / 2);
        var edge = Math.min(1, Math.min(ex, ez) * 3.2);
        h = 2 + (h - 2) * edge;
        var hi = Math.max(1, Math.min(HEIGHT - 10, h | 0));
        for (var y = 0; y < hi; y++) {
          var id = BLOCK.STONE;
          if (y === hi - 1) id = hi <= 4 ? BLOCK.SAND : BLOCK.GRASS;
          else if (y >= hi - 3) id = BLOCK.DIRT;
          data[idx(x, y, z)] = id;
        }
      }
    }
    plantTrees(n2);
    buildHouses();
  }

  function plantTrees(n2) {
    for (var x = 4; x < SIZE - 4; x += 2) {
      for (var z = 4; z < SIZE - 4; z += 2) {
        if (rng() > 0.012) continue;
        var y = surfaceY(x, z);
        if (y < 6 || y > HEIGHT - 9 || getBlock(x, y - 1, z) !== BLOCK.GRASS) continue;
        var th = 3 + (rng() * 3 | 0);
        for (var i = 0; i < th; i++) data[idx(x, y + i, z)] = BLOCK.WOOD;
        var ty = y + th;
        for (var dx = -2; dx <= 2; dx++) for (var dz = -2; dz <= 2; dz++) for (var dy = -1; dy <= 2; dy++) {
          var dist = Math.abs(dx) + Math.abs(dz) + Math.abs(dy);
          if (dist > 4 || (dy === 2 && dist > 2)) continue;
          var bx = x + dx, bz = z + dz, by = ty + dy;
          if (inBounds(bx, by, bz) && getBlock(bx, by, bz) === BLOCK.AIR) data[idx(bx, by, bz)] = BLOCK.LEAVES;
        }
      }
    }
  }

  function flatten(cx, cz, w, d) {
    var ys = [];
    for (var x = cx; x < cx + w; x++) for (var z = cz; z < cz + d; z++) ys.push(surfaceY(x, z));
    ys.sort(function (a, b) { return a - b; });
    var y = ys[(ys.length / 2) | 0];
    for (x = cx; x < cx + w; x++) for (z = cz; z < cz + d; z++) {
      for (var yy = y; yy < HEIGHT; yy++) data[idx(x, yy, z)] = BLOCK.AIR;
      for (yy = Math.max(0, y - 4); yy < y; yy++) data[idx(x, yy, z)] = yy === y - 1 ? BLOCK.DIRT : BLOCK.STONE;
    }
    return y;
  }

  function buildHouses() {
    var tries = 0, placed = 0;
    while (placed < 8 && tries++ < 200) {
      var w = 6 + (rng() * 3 | 0), d = 6 + (rng() * 3 | 0), hh = 4;
      var x0 = 8 + (rng() * (SIZE - 16 - w)) | 0, z0 = 8 + (rng() * (SIZE - 16 - d)) | 0;
      var ok = true;
      for (var i = 0; i < houseSpots.length; i++) {
        var s = houseSpots[i];
        if (Math.abs(s.x - x0) < 14 && Math.abs(s.z - z0) < 14) { ok = false; break; }
      }
      if (!ok) continue;
      var base = flatten(x0 - 1, z0 - 1, w + 2, d + 2);
      if (base < 5 || base > HEIGHT - 8) continue;
      var wall = rng() < 0.5 ? BLOCK.PLANK : BLOCK.BRICK;
      for (var x = x0; x < x0 + w; x++) for (var z = z0; z < z0 + d; z++) {
        data[idx(x, base - 1, z)] = BLOCK.PLANK; // 地板
        for (var y = base; y < base + hh; y++) {
          var isWall = (x === x0 || x === x0 + w - 1 || z === z0 || z === z0 + d - 1);
          var isRoof = (y === base + hh - 1);
          if (isRoof) data[idx(x, y, z)] = BLOCK.PLANK;
          else if (isWall) data[idx(x, y, z)] = wall;
          else data[idx(x, y, z)] = BLOCK.AIR;
        }
      }
      // 门洞 + 窗
      var doorX = x0 + ((w / 2) | 0);
      data[idx(doorX, base, z0)] = BLOCK.AIR;
      data[idx(doorX, base + 1, z0)] = BLOCK.AIR;
      data[idx(x0, base + 1, z0 + ((d / 2) | 0))] = BLOCK.AIR;
      data[idx(x0 + w - 1, base + 1, z0 + ((d / 2) | 0))] = BLOCK.AIR;
      houseSpots.push({ x: x0 + w / 2, z: z0 + d / 2, y: base });
      // 屋内物资点
      lootSpots.push({ x: x0 + 2 + rng() * (w - 4), y: base, z: z0 + 2 + rng() * (d - 4) });
      lootSpots.push({ x: x0 + 2 + rng() * (w - 4), y: base, z: z0 + 2 + rng() * (d - 4) });
      placed++;
    }
    // 野外物资点
    for (var k = 0; k < 36; k++) {
      var x = 10 + rng() * (SIZE - 20), z = 10 + rng() * (SIZE - 20);
      lootSpots.push({ x: x, y: surfaceY(x | 0, z | 0), z: z });
    }
  }

  // ---------------- 网格构建 ----------------
  var FACES = [
    { dir: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], shade: 0.8, tile: 2 },
    { dir: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], shade: 0.8, tile: 2 },
    { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0, tile: 0 },
    { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.55, tile: 1 },
    { dir: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], shade: 0.7, tile: 2 },
    { dir: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], shade: 0.7, tile: 2 },
  ];

  function buildChunk(cx, cz, tiles) {
    var pos = [], nor = [], uv = [], col = [], indices = [];
    var x0 = cx * CHUNK, z0 = cz * CHUNK;
    for (var x = x0; x < x0 + CHUNK; x++) {
      for (var z = z0; z < z0 + CHUNK; z++) {
        for (var y = 0; y < HEIGHT; y++) {
          var id = getBlock(x, y, z);
          if (id === BLOCK.AIR) continue;
          var ft = FACE_TILES[id];
          for (var f = 0; f < 6; f++) {
            var face = FACES[f];
            var nb = getBlock(x + face.dir[0], y + face.dir[1], z + face.dir[2]);
            if (nb !== BLOCK.AIR && !(nb === BLOCK.LEAVES && id !== BLOCK.LEAVES)) continue;
            var tileIdx = ft[face.tile];
            var u0 = tileIdx / tiles, u1 = (tileIdx + 1) / tiles;
            var vi = pos.length / 3;
            for (var c = 0; c < 4; c++) {
              var corner = face.corners[c];
              pos.push(x + corner[0], y + corner[1], z + corner[2]);
              nor.push(face.dir[0], face.dir[1], face.dir[2]);
              col.push(face.shade, face.shade, face.shade);
            }
            uv.push(u0, 0, u0, 1, u1, 1, u1, 0);
            // corners 按"从方块外侧看逆时针"排列，索引必须保持 0-1-2 / 0-2-3 顺序；
            // 反过来会让法线朝向方块内部，背面剔除后整个地形从外面看是透明的
            indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
          }
        }
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(indices);
    var mesh = new THREE.Mesh(geo, material);
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  function rebuildChunkAt(x, z) {
    var cx = (x / CHUNK) | 0, cz = (z / CHUNK) | 0;
    var key = cx + "," + cz;
    var old = chunkMeshes[key];
    if (old) { scene.remove(old); old.geometry.dispose(); }
    var mesh = buildChunk(cx, cz, World._tiles);
    chunkMeshes[key] = mesh;
    scene.add(mesh);
  }

  function rebuildAll() {
    var n = SIZE / CHUNK;
    for (var cx = 0; cx < n; cx++) for (var cz = 0; cz < n; cz++) rebuildChunkAt(cx * CHUNK, cz * CHUNK);
  }

  // ---------------- 修改方块 ----------------
  function setBlock(x, y, z, id) {
    x |= 0; y |= 0; z |= 0;
    if (!inBounds(x, y, z)) return false;
    if (y <= 0 && id === BLOCK.AIR) return false; // 保底层防穿地
    data[idx(x, y, z)] = id;
    delete damage[x + "," + y + "," + z];
    rebuildChunkAt(x, z);
    // 边界块需要同步重建相邻 chunk
    if (x % CHUNK === 0 && x > 0) rebuildChunkAt(x - 1, z);
    if (x % CHUNK === CHUNK - 1 && x < SIZE - 1) rebuildChunkAt(x + 1, z);
    if (z % CHUNK === 0 && z > 0) rebuildChunkAt(x, z - 1);
    if (z % CHUNK === CHUNK - 1 && z < SIZE - 1) rebuildChunkAt(x, z + 1);
    return true;
  }

  // 对方块造成伤害，打碎返回 true
  function damageBlock(x, y, z, dmg) {
    x |= 0; y |= 0; z |= 0;
    var id = getBlock(x, y, z);
    if (id === BLOCK.AIR) return false;
    if (y <= 0) return false;
    var key = x + "," + y + "," + z;
    var hp = (damage[key] !== undefined ? damage[key] : (BLOCK_HP[id] || 40)) - dmg;
    if (hp <= 0) { setBlock(x, y, z, BLOCK.AIR); return true; }
    damage[key] = hp;
    return false;
  }

  // ---------------- 体素射线（DDA） ----------------
  function raycastVoxel(origin, dir, maxDist) {
    var x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    var stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
    var tDX = Math.abs(1 / (dir.x || 1e-10)), tDY = Math.abs(1 / (dir.y || 1e-10)), tDZ = Math.abs(1 / (dir.z || 1e-10));
    var tMX = (dir.x > 0 ? (x + 1 - origin.x) : (origin.x - x)) * tDX;
    var tMY = (dir.y > 0 ? (y + 1 - origin.y) : (origin.y - y)) * tDY;
    var tMZ = (dir.z > 0 ? (z + 1 - origin.z) : (origin.z - z)) * tDZ;
    var dist = 0, nx = 0, ny = 0, nz = 0;
    for (var i = 0; i < 512; i++) {
      if (dist > maxDist) break;
      var id = getBlock(x, y, z);
      if (id !== BLOCK.AIR && dist > 0) {
        return { hit: true, x: x, y: y, z: z, id: id, dist: dist, normal: { x: nx, y: ny, z: nz } };
      }
      if (tMX < tMY && tMX < tMZ) { dist = tMX; tMX += tDX; x += stepX; nx = -stepX; ny = 0; nz = 0; }
      else if (tMY < tMZ) { dist = tMY; tMY += tDY; y += stepY; nx = 0; ny = -stepY; nz = 0; }
      else { dist = tMZ; tMZ += tDZ; z += stepZ; nx = 0; ny = 0; nz = -stepZ; }
      if (y < 0 || y >= HEIGHT) break;
    }
    return { hit: false, dist: maxDist };
  }

  // ---------------- 对外接口 ----------------
  var World = {
    BLOCK: BLOCK,
    SIZE: SIZE,
    HEIGHT: HEIGHT,
    _tiles: 0,
    lootSpots: lootSpots,
    houseSpots: houseSpots,
    init: function (sceneRef, seed) {
      scene = sceneRef;
      damage = {}; // 原地重开时清掉上一局的方块损伤，否则新地图同坐标方块会"预受伤"
      lootSpots.length = 0; houseSpots.length = 0;
      var atlas = buildAtlas();
      World._tiles = atlas.tiles;
      material = new THREE.MeshLambertMaterial({ map: atlas.texture, vertexColors: true });
      generate(seed);
      rebuildAll();
    },
    getBlock: getBlock,
    setBlock: setBlock,
    damageBlock: damageBlock,
    solidAt: solidAt,
    surfaceY: surfaceY,
    raycastVoxel: raycastVoxel,
    // 给小地图用：返回某列顶面方块 id 与高度
    topInfo: function (x, z) {
      for (var y = HEIGHT - 1; y >= 0; y--) {
        var id = getBlock(x, y, z);
        if (id !== BLOCK.AIR) return { id: id, y: y };
      }
      return { id: BLOCK.AIR, y: 0 };
    },
  };
  Chiji.World = World;
})();
