/* weapons.js — 枪械、射击判定（体素+实体）、战利品箱与背包 */
(function () {
  "use strict";
  var Chiji = (window.Chiji = window.Chiji || {});

  // ---------------- 枪械定义 ----------------
  var WEAPONS = {
    fist: { id: "fist", name: "拳头", dmg: 25, blockDmg: 15, rof: 0.45, range: 3.5, spread: 0, mag: Infinity, auto: false, pellets: 1, icon: "✊" },
    pistol: { id: "pistol", name: "手枪", dmg: 18, blockDmg: 18, rof: 0.28, range: 60, spread: 0.012, mag: 12, auto: false, pellets: 1, icon: "🔫" },
    rifle: { id: "rifle", name: "步枪", dmg: 26, blockDmg: 30, rof: 0.115, range: 90, spread: 0.02, mag: 30, auto: true, pellets: 1, icon: "🔫" },
    shotgun: { id: "shotgun", name: "霰弹枪", dmg: 12, blockDmg: 12, rof: 0.85, range: 24, spread: 0.07, mag: 6, auto: false, pellets: 7, icon: "💥" },
    sniper: { id: "sniper", name: "狙击枪", dmg: 80, blockDmg: 60, rof: 1.5, range: 160, spread: 0.002, mag: 5, auto: false, pellets: 1, icon: "🎯" },
  };
  var LOOT_WEAPONS = ["pistol", "pistol", "rifle", "rifle", "rifle", "shotgun", "shotgun", "sniper"];
  var TIER = { fist: 0, pistol: 1, shotgun: 2, rifle: 3, sniper: 4 };

  // ---------------- 背包 ----------------
  var inventory = {
    weapon: WEAPONS.fist,
    magAmmo: Infinity,   // 当前弹匣
    reserve: 0,          // 备弹
    medkits: 0,
    blocks: 0,
    reloading: 0,        // >0 表示换弹剩余秒数
    cooldown: 0,
  };

  function giveWeapon(wid) {
    var w = WEAPONS[wid];
    inventory.weapon = w;
    inventory.magAmmo = w.mag;
    inventory.reserve = Math.min(inventory.reserve + w.mag * 2, 240);
    inventory.reloading = 0;
  }

  // ---------------- 战利品箱 ----------------
  var crates = [];     // {pos, kind, mesh, taken}
  var scene = null, world = null;
  var CRATE_KINDS = ["weapon", "weapon", "ammo", "medkit", "blocks"];
  var crateGeo = null;
  var crateMats = {};

  function crateColor(kind) {
    return { weapon: 0xd9a13c, ammo: 0x4f8fd9, medkit: 0x4fc46a, blocks: 0xb06ad9 }[kind] || 0xffffff;
  }

  function spawnCrates() {
    if (!crateGeo) crateGeo = new THREE.BoxGeometry(0.62, 0.62, 0.62);
    var spots = world.lootSpots;
    for (var i = 0; i < spots.length; i++) {
      var s = spots[i];
      var kind = CRATE_KINDS[(Math.random() * CRATE_KINDS.length) | 0];
      // 必须用 lootSpot 自带的 y：屋内点存的是室内楼层高度，
      // 若用 surfaceY 会取到屋顶顶面，把“屋内物资”刷到屋顶上
      addCrate(s.x, s.y, s.z, kind);
    }
  }

  function addCrate(x, y, z, kind) {
    if (!crateMats[kind]) {
      crateMats[kind] = new THREE.MeshLambertMaterial({ color: crateColor(kind), emissive: crateColor(kind), emissiveIntensity: 0.35 });
    }
    var mesh = new THREE.Mesh(crateGeo, crateMats[kind]);
    mesh.position.set(x, y + 0.31, z);
    scene.add(mesh);
    crates.push({ pos: new THREE.Vector3(x, y, z), kind: kind, mesh: mesh, taken: false, baseY: y + 0.31 });
  }

  function updateCrates(dt, t, playerPos, playerAlive) {
    for (var i = 0; i < crates.length; i++) {
      var c = crates[i];
      if (c.taken) continue;
      c.mesh.rotation.y += dt * 1.2;
      c.mesh.position.y = c.baseY + Math.sin(t * 2 + i) * 0.12;
      if (!playerAlive) continue;
      var dx = c.pos.x - playerPos.x, dz = c.pos.z - playerPos.z, dy = c.pos.y - playerPos.y;
      if (dx * dx + dz * dz + dy * dy < 1.7) pickup(c);
    }
  }

  function pickup(c) {
    c.taken = true;
    scene.remove(c.mesh);
    var msg = "";
    if (c.kind === "weapon") {
      var wid = LOOT_WEAPONS[(Math.random() * LOOT_WEAPONS.length) | 0];
      // 只在更高级时替换，否则转化为弹药，避免捡到劣质枪降级
      if (TIER[wid] > TIER[inventory.weapon.id]) {
        giveWeapon(wid);
        msg = "拾取 " + WEAPONS[wid].name;
      } else {
        inventory.reserve = Math.min(inventory.reserve + WEAPONS[wid].mag, 240);
        msg = "弹药 +" + WEAPONS[wid].mag;
      }
    } else if (c.kind === "ammo") {
      inventory.reserve = Math.min(inventory.reserve + 30, 240);
      msg = "弹药 +30";
    } else if (c.kind === "medkit") {
      inventory.medkits += 1;
      msg = "医疗包 +1 (按 4 使用)";
    } else if (c.kind === "blocks") {
      inventory.blocks += 12;
      msg = "方块 +12 (右键放置)";
    } else if (c.kind === "airdrop") {
      if (TIER.sniper > TIER[inventory.weapon.id]) giveWeapon("sniper");
      else inventory.reserve = Math.min(inventory.reserve + WEAPONS.sniper.mag * 2, 240);
      inventory.reserve = Math.min(inventory.reserve + 30, 240);
      inventory.medkits += 2;
      msg = "🎁 空投：狙击枪 + 弹药 + 医疗包×2";
    }
    if (Chiji.Hud) Chiji.Hud.toast(msg);
    if (Chiji.Audio) Chiji.Audio.pickup();
  }

  // ---------------- 空投 ----------------
  // {group, chute, pos, landed, crate} — 落地后注册进 crates 走通用拾取流程
  var airdrops = [];

  function spawnAirdrop(x, z) {
    var group = new THREE.Group();
    var crateMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.9, 0.9),
      new THREE.MeshLambertMaterial({ color: 0xe8483a, emissive: 0xe8483a, emissiveIntensity: 0.45 })
    );
    crateMesh.position.y = 0.45;
    var chute = new THREE.Mesh(
      new THREE.ConeGeometry(1.9, 1.3, 8),
      new THREE.MeshLambertMaterial({ color: 0xff8c3a, side: THREE.DoubleSide })
    );
    chute.position.y = 2.7;
    // 红色光柱标记：落地前后都可远距离看到，箱子被拾走才消失
    var beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 70, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff5040, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false })
    );
    beacon.position.y = 35;
    group.add(crateMesh, chute, beacon);
    group.position.set(x, world.HEIGHT + 26, z);
    scene.add(group);
    airdrops.push({ group: group, chute: chute, pos: new THREE.Vector3(x, world.HEIGHT + 26, z), landed: false, crate: null });
    if (Chiji.Hud) Chiji.Hud.toast("📦 空投正在投放！跟着红色光柱走");
    if (Chiji.Audio) Chiji.Audio.chute();
  }

  function disposeAirdrop(a) {
    scene.remove(a.group);
    a.group.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }

  function updateAirdrops(dt) {
    for (var i = airdrops.length - 1; i >= 0; i--) {
      var a = airdrops[i];
      if (a.landed) {
        if (a.crate && a.crate.taken) { disposeAirdrop(a); airdrops.splice(i, 1); }
        continue;
      }
      a.pos.y -= 4.2 * dt; // 缓降
      a.group.position.y = a.pos.y;
      a.group.rotation.y += dt * 0.5;
      var ground = world.surfaceY(a.pos.x | 0, a.pos.z | 0);
      if (a.pos.y <= ground) {
        a.pos.y = ground;
        a.group.position.y = ground;
        a.group.rotation.y = 0;
        a.chute.visible = false;
        a.landed = true;
        // 注册为通用箱子：mesh 指向整组，拾取时连光柱一起移除
        a.crate = { pos: new THREE.Vector3(a.pos.x, ground, a.pos.z), kind: "airdrop", mesh: a.group, taken: false, baseY: ground };
        crates.push(a.crate);
        if (Chiji.Hud) Chiji.Hud.toast("空投已落地！");
        if (Chiji.Audio) Chiji.Audio.land();
      }
    }
  }

  // 给 AI 用：maxDist 内最近的未被拾取空投（含落地前）
  function nearestAirdrop(pos, maxDist) {
    var best = null, bestD = maxDist * maxDist;
    for (var i = 0; i < airdrops.length; i++) {
      var a = airdrops[i];
      if (a.crate && a.crate.taken) continue;
      var dx = a.pos.x - pos.x, dz = a.pos.z - pos.z;
      var d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; best = { x: a.pos.x, z: a.pos.z }; }
    }
    return best;
  }

  // 给小地图用
  function airdropMarkers() {
    var arr = [];
    for (var i = 0; i < airdrops.length; i++) {
      var a = airdrops[i];
      if (a.crate && a.crate.taken) continue;
      arr.push({ x: a.pos.x, z: a.pos.z, landed: a.landed });
    }
    return arr;
  }

  // 机器人死亡掉落
  function dropFrom(pos) {
    if (Math.random() < 0.7) {
      var kind = Math.random() < 0.5 ? "ammo" : (Math.random() < 0.6 ? "weapon" : "medkit");
      // 用死亡点实际高度：屋内死亡时 surfaceY 会取到屋顶，把掉落物传送到屋顶上
      addCrate(pos.x, pos.y, pos.z, kind);
    }
  }

  // 机器人捡物资：武器箱可升级手中枪，医疗箱低血量时回血；弹药/方块留给玩家
  function botPickup(bot) {
    for (var i = 0; i < crates.length; i++) {
      var c = crates[i];
      if (c.taken) continue;
      var dx = c.pos.x - bot.pos.x, dz = c.pos.z - bot.pos.z, dy = c.pos.y - bot.pos.y;
      if (dx * dx + dz * dz + dy * dy > 2.2) continue;
      if (c.kind === "weapon") {
        var wid = LOOT_WEAPONS[(Math.random() * LOOT_WEAPONS.length) | 0];
        if (TIER[wid] > TIER[bot.weapon.id]) {
          bot.weapon = WEAPONS[wid];
          c.taken = true;
          scene.remove(c.mesh);
        }
      } else if (c.kind === "medkit" && bot.health < 65) {
        bot.health = Math.min(100, bot.health + 50);
        c.taken = true;
        scene.remove(c.mesh);
      } else if (c.kind === "airdrop") {
        // 对 AI 有收益才拾取，否则留在原地继续制造争夺点
        var up = TIER.sniper > TIER[bot.weapon.id], hp = bot.health < 80;
        if (up || hp) {
          if (up) bot.weapon = WEAPONS.sniper;
          if (hp) bot.health = Math.min(100, bot.health + 50);
          c.taken = true;
          scene.remove(c.mesh);
        }
      }
    }
  }

  // ---------------- 弹道特效 ----------------
  var tracers = []; // {line, life}
  var tracerMat = null;

  function addTracer(from, to) {
    if (!tracerMat) tracerMat = new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9 });
    var geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    var line = new THREE.Line(geo, tracerMat); // 共享材质，避免每发子弹泄漏一份材质
    scene.add(line);
    tracers.push({ line: line, life: 0.07 });
  }

  var particles = []; // {mesh, vel, life}
  var particleGeo = null;
  function addHitParticles(at, color) {
    if (!particleGeo) particleGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
    for (var i = 0; i < 5; i++) {
      var m = new THREE.Mesh(particleGeo, new THREE.MeshBasicMaterial({ color: color }));
      m.position.copy(at);
      scene.add(m);
      particles.push({
        mesh: m,
        vel: new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 5, (Math.random() - 0.5) * 5),
        life: 0.4 + Math.random() * 0.25,
      });
    }
  }

  function updateFx(dt) {
    for (var i = tracers.length - 1; i >= 0; i--) {
      var t = tracers[i];
      t.life -= dt;
      if (t.life <= 0) { scene.remove(t.line); t.line.geometry.dispose(); tracers.splice(i, 1); }
    }
    for (i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt;
      p.vel.y -= 14 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.life <= 0) { scene.remove(p.mesh); p.mesh.material.dispose(); particles.splice(i, 1); }
    }
  }

  // ---------------- 射击判定 ----------------
  // 射线 vs AABB，返回命中距离或 -1
  function rayAABB(origin, dir, min, max) {
    var tmin = 0, tmax = 1e9;
    var axes = ["x", "y", "z"];
    for (var i = 0; i < 3; i++) {
      var a = axes[i];
      var d = dir[a];
      if (Math.abs(d) < 1e-9) {
        if (origin[a] < min[a] || origin[a] > max[a]) return -1;
      } else {
        var t1 = (min[a] - origin[a]) / d, t2 = (max[a] - origin[a]) / d;
        if (t1 > t2) { var tt = t1; t1 = t2; t2 = tt; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) return -1;
      }
    }
    return tmin;
  }

  // 单发子弹：origin/dir，target 列表 [{kind:'bot'|'player', ref, min(), max()}]
  // 返回 {type:'block'|'bot'|'player'|'none', ...}
  function fireBullet(shooterKind, origin, dir, weapon, targets) {
    var spread = weapon.spread;
    var d = dir.clone();
    d.x += (Math.random() - 0.5) * spread * 2;
    d.y += (Math.random() - 0.5) * spread * 2;
    d.z += (Math.random() - 0.5) * spread * 2;
    d.normalize();

    var blockHit = world.raycastVoxel(origin, d, weapon.range);
    var blockDist = blockHit.hit ? blockHit.dist : weapon.range;

    var bestDist = blockDist, bestTarget = null;
    for (var i = 0; i < targets.length; i++) {
      var tg = targets[i];
      var dist = rayAABB(origin, d, tg.min, tg.max);
      if (dist >= 0 && dist < bestDist) { bestDist = dist; bestTarget = tg; }
    }

    var end = origin.clone().addScaledVector(d, bestDist);
    if (shooterKind !== "fist") addTracer(origin.clone().addScaledVector(d, 0.4).add(new THREE.Vector3(0, -0.12, 0)), end);

    if (bestTarget) {
      addHitParticles(end, 0xc0392b);
      return { type: bestTarget.kind, target: bestTarget, dist: bestDist, point: end };
    }
    if (blockHit.hit) {
      addHitParticles(end, 0x9a8866);
      var broke = world.damageBlock(blockHit.x, blockHit.y, blockHit.z, weapon.blockDmg);
      if (broke && Chiji.Audio) Chiji.Audio.blockBreak();
      return { type: "block", broke: broke, point: end };
    }
    return { type: "none", point: end };
  }

  // 玩家开火（由 main 调用），返回是否真的射出
  function playerFire(targets) {
    var inv = inventory, w = inv.weapon;
    if (inv.cooldown > 0 || inv.reloading > 0) return false;
    if (w.id !== "fist" && inv.magAmmo <= 0) {
      if (Chiji.Audio) Chiji.Audio.empty();
      inv.cooldown = 0.3; // 防止按住连发时空仓声轰炸
      tryReload();
      return false;
    }
    inv.cooldown = w.rof;
    if (w.id !== "fist") inv.magAmmo--;

    // 开镜射击更稳（散布减半再多些）
    var wFire = w;
    if (Chiji.Player.zoomed && w.spread > 0) {
      wFire = { id: w.id, dmg: w.dmg, blockDmg: w.blockDmg, range: w.range, spread: w.spread * 0.45, mag: w.mag, auto: w.auto, pellets: w.pellets };
    }

    var origin = Chiji.Player.eyePos();
    var dir = Chiji.Player.lookDir();
    var hits = [];
    for (var p = 0; p < w.pellets; p++) {
      hits.push(fireBullet(w.id, origin, dir, wFire, targets));
    }
    if (Chiji.Audio) Chiji.Audio.shot(w.id);
    if (Chiji.Hud) Chiji.Hud.recoil();
    return hits;
  }

  function tryReload() {
    var inv = inventory, w = inv.weapon;
    if (w.id === "fist" || inv.reloading > 0) return;
    if (inv.magAmmo >= w.mag || inv.reserve <= 0) return;
    inv.reloading = 1.6;
    if (Chiji.Audio) Chiji.Audio.reload();
  }

  function update(dt, t, playerPos, playerAlive) {
    var inv = inventory;
    if (inv.cooldown > 0) inv.cooldown -= dt;
    if (inv.reloading > 0) {
      inv.reloading -= dt;
      if (inv.reloading <= 0) {
        var need = inv.weapon.mag - inv.magAmmo;
        var take = Math.min(need, inv.reserve);
        inv.magAmmo += take;
        inv.reserve -= take;
        inv.reloading = 0;
      }
    }
    updateCrates(dt, t, playerPos, playerAlive);
    updateAirdrops(dt);
    updateFx(dt);
  }

  function useMedkit() {
    if (inventory.medkits <= 0) { if (Chiji.Hud) Chiji.Hud.toast("没有医疗包"); return; }
    if (Chiji.Player.heal(60)) {
      inventory.medkits--;
      if (Chiji.Hud) Chiji.Hud.toast("使用医疗包 +60");
    }
  }

  Chiji.Weapons = {
    WEAPONS: WEAPONS,
    LOOT_WEAPONS: LOOT_WEAPONS,
    inventory: inventory,
    init: function (sceneRef, worldRef) {
      scene = sceneRef; world = worldRef;
      // 重开一局时清掉上一局残留的箱子、空投与特效
      for (var i = 0; i < crates.length; i++) {
        if (!crates[i].taken) scene.remove(crates[i].mesh);
      }
      crates.length = 0;
      for (i = 0; i < airdrops.length; i++) disposeAirdrop(airdrops[i]);
      airdrops.length = 0;
      for (i = 0; i < tracers.length; i++) { scene.remove(tracers[i].line); tracers[i].line.geometry.dispose(); }
      tracers.length = 0;
      for (i = 0; i < particles.length; i++) { scene.remove(particles[i].mesh); particles[i].mesh.material.dispose(); }
      particles.length = 0;
      inventory.weapon = WEAPONS.fist;
      inventory.magAmmo = Infinity;
      inventory.reserve = 0; inventory.medkits = 0; inventory.blocks = 0;
      inventory.reloading = 0; inventory.cooldown = 0;
      spawnCrates();
    },
    update: update,
    playerFire: playerFire,
    fireBullet: fireBullet,
    tryReload: tryReload,
    useMedkit: useMedkit,
    dropFrom: dropFrom,
    botPickup: botPickup,
    giveWeapon: giveWeapon,
    spawnAirdrop: spawnAirdrop,
    nearestAirdrop: nearestAirdrop,
    airdropMarkers: airdropMarkers,
  };
})();
