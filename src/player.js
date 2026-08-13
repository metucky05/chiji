/* player.js — 第一人称玩家：指针锁控制、体素 AABB 碰撞、跳伞空降、生命值 */
(function () {
  "use strict";
  var Chiji = (window.Chiji = window.Chiji || {});

  // ---------------- 通用体素物理（玩家与机器人共用） ----------------
  // aabb: {hw 半宽, hh 半高}，pos 为脚底中心点
  function collideMove(pos, vel, dt, hw, hh, world) {
    var onGround = false;
    function solidBox(minX, minY, minZ, maxX, maxY, maxZ) {
      var x0 = Math.floor(minX), x1 = Math.floor(maxX);
      var y0 = Math.floor(minY), y1 = Math.floor(maxY);
      var z0 = Math.floor(minZ), z1 = Math.floor(maxZ);
      for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) for (var z = z0; z <= z1; z++) {
        if (world.solidAt(x, y, z)) return true;
      }
      return false;
    }
    // X 轴
    var nx = pos.x + vel.x * dt;
    if (vel.x !== 0 && solidBox(nx - hw, pos.y + 0.02, pos.z - hw, nx + hw, pos.y + hh * 2 - 0.02, pos.z + hw)) {
      vel.x = 0;
    } else pos.x = nx;
    // Z 轴
    var nz = pos.z + vel.z * dt;
    if (vel.z !== 0 && solidBox(pos.x - hw, pos.y + 0.02, nz - hw, pos.x + hw, pos.y + hh * 2 - 0.02, nz + hw)) {
      vel.z = 0;
    } else pos.z = nz;
    // Y 轴
    var ny = pos.y + vel.y * dt;
    if (vel.y < 0) {
      if (solidBox(pos.x - hw, ny, pos.z - hw, pos.x + hw, ny + 0.01, pos.z + hw)) {
        pos.y = Math.floor(ny) + 1;
        vel.y = 0; onGround = true;
      } else pos.y = ny;
    } else if (vel.y > 0) {
      if (solidBox(pos.x - hw, ny + hh * 2, pos.z - hw, pos.x + hw, ny + hh * 2 + 0.01, pos.z + hw)) {
        vel.y = 0;
      } else pos.y = ny;
    }
    return onGround;
  }
  Chiji.Physics = { collideMove: collideMove };

  // ---------------- 玩家 ----------------
  var GRAVITY = -24, JUMP = 8.4, SPEED = 5.6, RUN = 8.2;
  var CHUTE_FALL = -7, FREE_FALL = -38, CHUTE_DRIFT = 9;

  var Player = {
    pos: null, vel: null, yaw: 0, pitch: 0,
    health: 100, alive: true, onGround: false,
    dropping: false, chuteOpen: false,
    kills: 0,
    eyeHeight: 1.62, hw: 0.32, hh: 0.9,
    camera: null, world: null,
    lastDamageFrom: null,
    landed: false,
    zoomed: false, sens: 1,

    init: function (camera, world) {
      this.camera = camera;
      this.world = world;
      this.pos = new THREE.Vector3();
      this.vel = new THREE.Vector3();
    },

    // 跳伞出生
    startDrop: function (x, z) {
      this.pos.set(x, this.world.HEIGHT + 78, z);
      this.vel.set(0, 0, 0);
      this.health = 100; this.alive = true; this.kills = 0;
      this.dropping = true; this.chuteOpen = false; this.landed = false;
      this.yaw = Math.PI * 0.25; this.pitch = -0.5;
    },

    rotate: function (dx, dy) {
      var s = 0.0024 * (this.sens || 1); // 开镜时降低灵敏度
      this.yaw -= dx * s;
      this.pitch -= dy * s;
      var lim = Math.PI / 2 - 0.01;
      if (this.pitch > lim) this.pitch = lim;
      if (this.pitch < -lim) this.pitch = -lim;
    },

    forwardDir: function () {
      return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    },
    lookDir: function () {
      var cp = Math.cos(this.pitch);
      return new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp).normalize();
    },
    eyePos: function () {
      return new THREE.Vector3(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
    },

    update: function (dt, input) {
      if (!this.alive) return;
      var w = this.world;

      if (this.dropping) {
        // 空降阶段：自由落体 → 距地 ~26m 自动开伞
        var ground = w.surfaceY(this.pos.x | 0, this.pos.z | 0);
        if (!this.chuteOpen && this.pos.y - ground < 26) {
          this.chuteOpen = true;
          if (Chiji.Audio) Chiji.Audio.chute();
        }
        var fall = this.chuteOpen ? CHUTE_FALL : FREE_FALL;
        this.vel.y += (fall - this.vel.y) * Math.min(1, dt * (this.chuteOpen ? 3.2 : 1.2));
        // 空中按 WASD 漂移
        var move = new THREE.Vector3();
        var fwd = this.forwardDir();
        var right = new THREE.Vector3(-fwd.z, 0, fwd.x);
        if (input.f) move.add(fwd);
        if (input.b) move.sub(fwd);
        if (input.r) move.add(right);
        if (input.l) move.sub(right);
        if (move.lengthSq() > 0) move.normalize().multiplyScalar(this.chuteOpen ? CHUTE_DRIFT : 14);
        this.vel.x += (move.x - this.vel.x) * Math.min(1, dt * 2.5);
        this.vel.z += (move.z - this.vel.z) * Math.min(1, dt * 2.5);

        this.pos.x += this.vel.x * dt;
        this.pos.z += this.vel.z * dt;
        this.pos.y += this.vel.y * dt;
        this.pos.x = Math.max(1, Math.min(w.SIZE - 1, this.pos.x));
        this.pos.z = Math.max(1, Math.min(w.SIZE - 1, this.pos.z));
        ground = w.surfaceY(this.pos.x | 0, this.pos.z | 0);
        if (this.pos.y <= ground) {
          this.pos.y = ground;
          this.dropping = false; this.landed = true;
          this.vel.set(0, 0, 0);
          if (Chiji.Audio) Chiji.Audio.land();
        }
      } else {
        // 地面阶段
        var move2 = new THREE.Vector3();
        var fwd2 = this.forwardDir();
        var right2 = new THREE.Vector3(-fwd2.z, 0, fwd2.x);
        if (input.f) move2.add(fwd2);
        if (input.b) move2.sub(fwd2);
        if (input.r) move2.add(right2);
        if (input.l) move2.sub(right2);
        var speed = input.run ? RUN : SPEED;
        if (this.zoomed) speed *= 0.55; // 开镜慢走
        if (move2.lengthSq() > 0) move2.normalize().multiplyScalar(speed);
        var accel = this.onGround ? 14 : 4;
        this.vel.x += (move2.x - this.vel.x) * Math.min(1, dt * accel);
        this.vel.z += (move2.z - this.vel.z) * Math.min(1, dt * accel);
        this.vel.y += GRAVITY * dt;
        if (input.jump && this.onGround) {
          this.vel.y = JUMP;
          this.onGround = false;
        }
        var vyBefore = this.vel.y;
        this.onGround = collideMove(this.pos, this.vel, dt, this.hw, this.hh, w);
        // 摔落伤害
        if (this.onGround && vyBefore < -16) {
          this.takeDamage(Math.round((-vyBefore - 16) * 4), null, "摔落");
        }
        this.pos.x = Math.max(1, Math.min(w.SIZE - 1, this.pos.x));
        this.pos.z = Math.max(1, Math.min(w.SIZE - 1, this.pos.z));
        if (this.pos.y < -10) this.takeDamage(999, null, "虚空");
      }

      // 开镜：FOV 平滑过渡，狙击高倍
      var wpn = Chiji.Weapons ? Chiji.Weapons.inventory.weapon : null;
      var canZoom = this.alive && !this.dropping && wpn && wpn.id !== "fist";
      this.zoomed = !!(canZoom && input.zoom);
      var sniper = wpn && wpn.id === "sniper";
      this.sens = this.zoomed ? (sniper ? 0.35 : 0.6) : 1;
      var targetFov = this.zoomed ? (sniper ? 22 : 50) : 75;
      if (Math.abs(this.camera.fov - targetFov) > 0.05) {
        this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 12);
        this.camera.updateProjectionMatrix();
      }

      // 相机同步
      this.camera.position.copy(this.eyePos());
      this.camera.rotation.set(0, 0, 0);
      this.camera.rotateY(this.yaw);
      this.camera.rotateX(this.pitch);
    },

    takeDamage: function (dmg, from, cause) {
      if (!this.alive) return;
      this.health -= dmg;
      this.lastDamageFrom = from || cause || "毒圈";
      if (Chiji.Hud) Chiji.Hud.flashDamage();
      if (Chiji.Audio) Chiji.Audio.hurt();
      if (this.health <= 0) {
        this.health = 0;
        this.alive = false;
        if (Chiji.Main) Chiji.Main.onPlayerDeath(this.lastDamageFrom);
      }
    },

    heal: function (amount) {
      if (!this.alive) return false;
      if (this.health >= 100) return false;
      this.health = Math.min(100, this.health + amount);
      if (Chiji.Audio) Chiji.Audio.heal();
      return true;
    },
  };
  Chiji.Player = Player;
})();
