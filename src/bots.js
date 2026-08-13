/* bots.js — AI 机器人：方块小人外观，空降/游走/进圈/交战状态机 */
(function () {
  "use strict";
  var Chiji = (window.Chiji = window.Chiji || {});

  var NAMES = [
    "落地成盒", "伏地魔", "天命圈皇", "人体描边", "快递员",
    "平底锅侠", "98K战神", "苟到决赛", "桥头堵狗", "野区萌新",
    "光子鸡", "三级头铁", "空投猎人", "草丛阴雕", "刚枪大佬",
  ];
  var SHIRT_COLORS = [0xc0392b, 0x2980b9, 0x27ae60, 0x8e44ad, 0xd35400, 0x16a085, 0x7f8c8d, 0xf39c12];

  var bots = [];
  var scene = null, world = null;
  var GRAVITY = -24;

  // ---------------- 外观 ----------------
  function buildMesh(shirtColor) {
    var g = new THREE.Group();
    var skin = new THREE.MeshLambertMaterial({ color: 0xe0b9a2 });
    var shirt = new THREE.MeshLambertMaterial({ color: shirtColor });
    var pants = new THREE.MeshLambertMaterial({ color: 0x34495e });

    var head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), skin);
    head.position.y = 1.55;
    var body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.32), shirt);
    body.position.y = 0.95;
    var armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.66, 0.18), shirt);
    armL.position.set(-0.38, 0.95, 0);
    var armR = armL.clone();
    armR.position.x = 0.38;
    var legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.2), pants);
    legL.position.set(-0.14, 0.31, 0);
    var legR = legL.clone();
    legR.position.x = 0.14;
    var gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.7), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    gun.position.set(0.38, 0.98, -0.4);
    g.add(head, body, armL, armR, legL, legR, gun);

    // 降落伞（着陆后隐藏）
    var chute = new THREE.Mesh(
      new THREE.ConeGeometry(1.5, 1.0, 8),
      new THREE.MeshLambertMaterial({ color: SHIRT_COLORS[(Math.random() * SHIRT_COLORS.length) | 0], side: THREE.DoubleSide })
    );
    chute.position.y = 3.2;
    g.add(chute);
    return { group: g, armL: armL, armR: armR, legL: legL, legR: legR, chute: chute };
  }

  // ---------------- 初始化 ----------------
  function init(sceneRef, worldRef, count) {
    scene = sceneRef; world = worldRef;
    for (var i = 0; i < bots.length; i++) scene.remove(bots[i].parts.group);
    bots.length = 0;
    var names = NAMES.slice();
    for (i = 0; i < count; i++) {
      var parts = buildMesh(SHIRT_COLORS[i % SHIRT_COLORS.length]);
      var x = 12 + Math.random() * (world.SIZE - 24);
      var z = 12 + Math.random() * (world.SIZE - 24);
      var bot = {
        name: names.splice((Math.random() * names.length) | 0, 1)[0] || "Bot" + i,
        pos: new THREE.Vector3(x, world.HEIGHT + 40 + Math.random() * 50, z),
        vel: new THREE.Vector3(),
        yaw: Math.random() * Math.PI * 2,
        health: 100, alive: true,
        dropping: true,
        state: "wander",
        waypoint: null,
        weapon: Chiji.Weapons.WEAPONS[["pistol", "rifle", "rifle", "shotgun"][(Math.random() * 4) | 0]],
        cooldown: 1 + Math.random() * 2,
        reactTimer: 0,
        thinkTimer: Math.random(),
        strafeDir: 1,
        kills: 0,
        parts: parts,
        anim: Math.random() * 10,
        deathTimer: 0,
        lastKnown: null, // 目标最后已知位置（反龟缩/追击用）
        safeTimer: 0,    // 落地后的出生保护：期间不索敌
      };
      parts.group.position.copy(bot.pos);
      scene.add(parts.group);
      bots.push(bot);
    }
  }

  function aliveCount() {
    var n = 0;
    for (var i = 0; i < bots.length; i++) if (bots[i].alive) n++;
    return n;
  }

  function aliveBots() {
    var arr = [];
    for (var i = 0; i < bots.length; i++) if (bots[i].alive) arr.push(bots[i]);
    return arr;
  }

  // 机器人 AABB（射击判定用）
  function botAABB(b) {
    return {
      kind: "bot", ref: b,
      min: { x: b.pos.x - 0.35, y: b.pos.y, z: b.pos.z - 0.35 },
      max: { x: b.pos.x + 0.35, y: b.pos.y + 1.8, z: b.pos.z + 0.35 },
    };
  }

  // 视线检查（体素遮挡）
  function canSee(fromEye, toEye, maxDist) {
    var dir = toEye.clone().sub(fromEye);
    var dist = dir.length();
    if (dist > maxDist) return false;
    dir.normalize();
    var hit = world.raycastVoxel(fromEye, dir, dist - 0.5);
    return !hit.hit;
  }

  function eyeOf(b) { return new THREE.Vector3(b.pos.x, b.pos.y + 1.55, b.pos.z); }

  // ---------------- 主更新 ----------------
  // ctx.peace=true 时为菜单展示模式：只空降+游走，不索敌不掉血
  function update(dt, ctx) {
    var player = Chiji.Player, zone = Chiji.Zone;
    var peace = !!(ctx && ctx.peace);
    for (var i = 0; i < bots.length; i++) {
      var b = bots[i];
      if (!b.alive) {
        if (b.deathTimer > 0) {
          b.deathTimer -= dt;
          b.parts.group.rotation.x = Math.min(Math.PI / 2, b.parts.group.rotation.x + dt * 5);
          if (b.deathTimer <= 0) scene.remove(b.parts.group);
        }
        continue;
      }

      if (b.dropping) {
        updateDrop(b, dt);
        continue;
      }

      b.thinkTimer -= dt;
      b.cooldown -= dt;
      if (b.safeTimer > 0) b.safeTimer -= dt;

      // 1) 目标感知（玩家 + 其他机器人）+ 顺路捡物资
      if (b.thinkTimer <= 0) {
        b.thinkTimer = 0.25 + Math.random() * 0.2;
        b.target = peace ? null : findTarget(b, player);
        if (!peace) Chiji.Weapons.botPickup(b);
      }

      // 2) 状态决策（breach=目标刚失踪：追到最后已知位置，必要时拆墙）
      var inZone = peace ? true : zone.contains(b.pos);
      if (b.target) b.state = "engage";
      else if (!inZone) b.state = "tozone";
      else if (!peace && b.lastKnown) b.state = "breach";
      else b.state = "wander";

      // 3) 行为
      var moveDir = null, speed = 4.4;
      if (b.state === "engage") {
        var tEye = b.target.kind === "player" ? player.eyePos() : eyeOf(b.target.ref);
        // 记住目标位置：丢失视线后用于追击/拆掩体
        if (b.lastKnown) { b.lastKnown.x = tEye.x; b.lastKnown.y = tEye.y; b.lastKnown.z = tEye.z; b.lastKnown.t = 10; }
        else b.lastKnown = { x: tEye.x, y: tEye.y, z: tEye.z, t: 10 };
        var dx = tEye.x - b.pos.x, dz = tEye.z - b.pos.z;
        var dist = Math.sqrt(dx * dx + dz * dz);
        b.yaw = Math.atan2(-dx, -dz);
        // 保持距离：太近后撤，太远逼近，中距横移；狙击手拉更远
        var ideal = b.weapon.id === "shotgun" ? 8 : (b.weapon.id === "sniper" ? 26 : 18);
        if (dist > ideal + 6) moveDir = { x: dx / dist, z: dz / dist };
        else if (dist < ideal - 4) moveDir = { x: -dx / dist, z: -dz / dist };
        else {
          if (Math.random() < dt * 0.8) b.strafeDir *= -1;
          moveDir = { x: -dz / dist * b.strafeDir, z: dx / dist * b.strafeDir };
        }
        speed = 4.8;
        // 开火
        b.reactTimer -= dt;
        if (b.reactTimer <= 0 && b.cooldown <= 0) {
          botShoot(b, tEye);
          b.cooldown = b.weapon.rof * (1.6 + Math.random() * 1.2);
        }
      } else if (b.state === "breach") {
        // 反龟缩：朝最后已知位置推进；12m 内若有体素遮挡就开枪拆墙
        var lk = b.lastKnown;
        lk.t -= dt;
        var bdx = lk.x - b.pos.x, bdz = lk.z - b.pos.z;
        var bdist = Math.sqrt(bdx * bdx + bdz * bdz) || 1;
        b.yaw = Math.atan2(-bdx, -bdz);
        if (lk.t <= 0) {
          b.lastKnown = null; // 追太久放弃
        } else if (bdist > 12) {
          moveDir = { x: bdx / bdist, z: bdz / bdist };
          speed = 5.0;
        } else {
          var lkEye = new THREE.Vector3(lk.x, lk.y, lk.z);
          var myEye = eyeOf(b);
          var toLk = lkEye.clone().sub(myEye);
          var lkDist = toLk.length();
          var blocked = lkDist > 0.6 && world.raycastVoxel(myEye, toLk.normalize(), lkDist - 0.4).hit;
          if (blocked) {
            if (bdist > 4) moveDir = { x: bdx / bdist, z: bdz / bdist }; // 贴近掩体再打更省弹道
            if (b.cooldown <= 0) {
              botShoot(b, lkEye); // 弹道打在遮挡方块上，复用 fireBullet 的 blockDmg
              b.cooldown = b.weapon.rof * (1.4 + Math.random() * 0.8);
            }
          } else if (bdist < 2.5) {
            b.lastKnown = null; // 走到地方没人：放弃搜索
          } else {
            moveDir = { x: bdx / bdist, z: bdz / bdist };
            speed = 5.0;
          }
        }
      } else if (b.state === "tozone") {
        var c = zone.current;
        var ddx = c.x - b.pos.x, ddz = c.z - b.pos.z;
        var dd = Math.sqrt(ddx * ddx + ddz * ddz) || 1;
        moveDir = { x: ddx / dd, z: ddz / dd };
        b.yaw = Math.atan2(-ddx, -ddz);
        speed = 5.4;
      } else {
        // 游走：随机路点；附近 30m 有空投时优先赶去抢
        if (!b.waypoint || b.thinkTimer < 0.1 && Math.random() < 0.15) {
          var ad = (!peace && Chiji.Weapons.nearestAirdrop) ? Chiji.Weapons.nearestAirdrop(b.pos, 30) : null;
          if (ad && (b.weapon.id !== "sniper" || b.health < 65)) {
            b.waypoint = { x: ad.x, z: ad.z };
          } else {
            var zc = zone.current;
            var ang = Math.random() * Math.PI * 2;
            var rr = Math.random() * Math.max(8, zc.r * 0.8);
            b.waypoint = { x: zc.x + Math.cos(ang) * rr, z: zc.z + Math.sin(ang) * rr };
          }
        }
        var wx = b.waypoint.x - b.pos.x, wz = b.waypoint.z - b.pos.z;
        var wd = Math.sqrt(wx * wx + wz * wz);
        if (wd < 2) b.waypoint = null;
        else {
          moveDir = { x: wx / wd, z: wz / wd };
          b.yaw = Math.atan2(-wx, -wz);
        }
        speed = 3.2;
      }

      // 4) 物理移动
      var desiredX = moveDir ? moveDir.x * speed : 0;
      var desiredZ = moveDir ? moveDir.z * speed : 0;
      b.vel.x += (desiredX - b.vel.x) * Math.min(1, dt * 10);
      b.vel.z += (desiredZ - b.vel.z) * Math.min(1, dt * 10);
      b.vel.y += GRAVITY * dt;
      var beforeX = b.pos.x, beforeZ = b.pos.z;
      var onGround = Chiji.Physics.collideMove(b.pos, b.vel, dt, 0.3, 0.9, world);
      // 卡墙自动跳
      if (moveDir && onGround) {
        var movedSq = (b.pos.x - beforeX) * (b.pos.x - beforeX) + (b.pos.z - beforeZ) * (b.pos.z - beforeZ);
        if (movedSq < (speed * dt * 0.3) * (speed * dt * 0.3)) b.vel.y = 8.4;
      }
      b.pos.x = Math.max(1, Math.min(world.SIZE - 1, b.pos.x));
      b.pos.z = Math.max(1, Math.min(world.SIZE - 1, b.pos.z));

      // 5) 毒圈伤害
      if (!peace && !inZone) damageBot(b, zone.damagePerSec() * dt, null, "毒圈");

      // 6) 动画与同步
      b.anim += dt * (moveDir ? 8 : 2);
      var swing = Math.sin(b.anim) * (moveDir ? 0.6 : 0.05);
      b.parts.armL.rotation.x = swing;
      b.parts.armR.rotation.x = -swing;
      b.parts.legL.rotation.x = -swing;
      b.parts.legR.rotation.x = swing;
      b.parts.group.position.copy(b.pos);
      b.parts.group.rotation.y = b.yaw;
    }
  }

  function updateDrop(b, dt) {
    var ground = world.surfaceY(b.pos.x | 0, b.pos.z | 0);
    var chuteOpen = b.pos.y - ground < 30;
    b.parts.chute.visible = chuteOpen;
    var fall = chuteOpen ? -7.5 : -32;
    b.vel.y += (fall - b.vel.y) * Math.min(1, dt * 2.5);
    b.pos.y += b.vel.y * dt;
    if (b.pos.y <= ground) {
      b.pos.y = ground;
      b.dropping = false;
      b.vel.set(0, 0, 0);
      b.parts.chute.visible = false;
      b.safeTimer = 5; // 出生保护：落地 5 秒内不索敌，避免开局互射减员过快
    }
    b.parts.group.position.copy(b.pos);
  }

  function findTarget(b, player) {
    if (b.safeTimer > 0) return null; // 出生保护期不索敌
    var best = null, bestDist = 46; // 视野半径
    var myEye = eyeOf(b);
    if (player.alive && !player.dropping) {
      var pEye = player.eyePos();
      var d = myEye.distanceTo(pEye);
      if (d < bestDist && canSee(myEye, pEye, 46)) { best = { kind: "player", ref: player }; bestDist = d; }
    }
    for (var i = 0; i < bots.length; i++) {
      var o = bots[i];
      if (o === b || !o.alive || o.dropping) continue;
      var oEye = eyeOf(o);
      var d2 = myEye.distanceTo(oEye);
      if (d2 < bestDist && canSee(myEye, oEye, 46)) { best = { kind: "bot", ref: o }; bestDist = d2; }
    }
    if (best && b.target == null) b.reactTimer = 0.35 + Math.random() * 0.5; // 首次发现的反应时间
    return best;
  }

  function botShoot(b, targetEye) {
    var origin = eyeOf(b);
    var dir = targetEye.clone().sub(origin).normalize();
    // 机器人散布更大（难度平衡）
    var w = b.weapon;
    var fakeWeapon = { id: w.id, dmg: w.dmg * 0.55, blockDmg: w.blockDmg, range: w.range, spread: w.spread * 3 + 0.025, pellets: w.pellets };
    var targets = [];
    var player = Chiji.Player;
    if (player.alive && !player.dropping) {
      targets.push({
        kind: "player", ref: player,
        min: { x: player.pos.x - 0.32, y: player.pos.y, z: player.pos.z - 0.32 },
        max: { x: player.pos.x + 0.32, y: player.pos.y + 1.8, z: player.pos.z + 0.32 },
      });
    }
    for (var i = 0; i < bots.length; i++) {
      var o = bots[i];
      if (o === b || !o.alive || o.dropping) continue;
      targets.push(botAABB(o));
    }
    var hits = [];
    for (var p = 0; p < fakeWeapon.pellets; p++) hits.push(Chiji.Weapons.fireBullet(w.id, origin, dir, fakeWeapon, targets));
    if (Chiji.Audio) Chiji.Audio.shotAt(w.id, origin);
    for (i = 0; i < hits.length; i++) {
      var h = hits[i];
      if (h.type === "player") h.target.ref.takeDamage(Math.round(fakeWeapon.dmg), b.name, b.name);
      else if (h.type === "bot") damageBot(h.target.ref, fakeWeapon.dmg, b, b.name + " 的 " + w.name);
    }
  }

  function damageBot(b, dmg, fromBot, causeName) {
    if (!b.alive) return false;
    b.health -= dmg;
    if (b.health <= 0) {
      b.alive = false;
      b.deathTimer = 1.2;
      b.target = null;
      Chiji.Weapons.dropFrom(b.pos);
      if (fromBot) fromBot.kills++;
      var killer = fromBot ? fromBot.name : (causeName || "毒圈");
      if (Chiji.Main) Chiji.Main.onBotDeath(b, killer);
      return true;
    }
    return false;
  }

  Chiji.Bots = {
    list: bots,
    init: init,
    update: update,
    aliveCount: aliveCount,
    aliveBots: aliveBots,
    botAABB: botAABB,
    damageBot: damageBot,
  };
})();
