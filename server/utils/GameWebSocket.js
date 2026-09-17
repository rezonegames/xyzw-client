/**
 * XYZW Game WebSocket Client — Node.js 服务端版本
 * 基于前端 xyzwWebSocket.js 移植，使用 ws 包代替浏览器 WebSocket
 */

const WebSocket = require('ws');
const { g_utils, bon, getEnc, encode, parse } = require('./bonProtocol');

/** 错误码映射 */
const errorCodeMap = {
  700010: '任务未达成完成条件',
  200020: '出了点小问题',
  200160: '模块未开启',
  200400: '操作太快',
  2300190: '今天已经签到过了',
  400010: '物品数量不足',
  1500010: '已经全部通关',
  12400000: '挂机奖励领取过于频繁',
  2300250: '俱乐部BOSS今日攻打次数已用完',
  3300050: '购买数量超出限制',
  700020: '已经领取过这个任务',
  1000020: '今天已经领取过奖励了',
  12000116: '今日已领取免费奖励',
  3300060: '扫荡条件不满足',
  1300050: '请修改您的采购次数',
  400000: '物品不存在',
  1500020: '能量不足',
  2300070: '未加入俱乐部',
  3500020: '没有可领取的奖励',
  12000050: '今日发车次数已达上限',
  400190: '没有可领取的签到奖励',
  7900023: '已达到使用次数上限',
  12300040: '没有空格子了',
};

/** 响应命令 → 原始命令 映射 */
const responseToCommandMap = {
  // 1:1 响应映射
  fight_startpvpresp: 'fight_startpvp',
  activity_getresp: 'activity_get',
  collection_goodslistresp: 'collection_goodslist',
  collection_claimfreerewardresp: 'collection_claimfreereward',
  legion_getarearankresp: 'legion_getarearank',
  legionwar_getgoldmonthwarrankresp: 'legionwar_getgoldmonthwarrank',
  nightmare_getroleinforesp: 'nightmare_getroleinfo',
  fight_startlevelresp: 'fight_startlevel',
  fight_calcleveltimeresp: 'fight_calcleveltime',
  fight_levelresp: 'fight_level',
  studyresp: 'study_startgame',
  role_getroleinforesp: 'role_getroleinfo',
  apex_getroleinforesp: 'apex_getroleinfo',
  apex_getguesslistresp: 'apex_getguesslist',
  apex_guessresp: 'apex_guess',
  apex_get64oppomapresp: 'apex_get64oppomap',
  hero_recruitresp: 'hero_recruit',
  friend_batchresp: 'friend_batch',
  system_claimhanguprewardresp: 'system_claimhangupreward',
  system_hangupupgraderesp: 'system_hangupupgrade',
  item_openboxresp: ['item_openbox', 'item_batchclaimboxpointreward'],
  item_consumeresp: 'item_consume',
  bottlehelper_claimresp: 'bottlehelper_claim',
  bottlehelper_startresp: 'bottlehelper_start',
  bottlehelper_stopresp: 'bottlehelper_stop',
  legion_signinresp: 'legion_signin',
  fight_startbossresp: 'fight_startboss',
  fight_startlegionbossresp: 'fight_startlegionboss',
  fight_startareaarenaresp: 'fight_startareaarena',
  arena_startarearesp: 'arena_startarea',
  arena_getareatargetresp: 'arena_getareatarget',
  arena_getarearankresp: 'arena_getarearank',
  presetteam_saveteamresp: 'presetteam_saveteam',
  presetteam_getinforesp: 'presetteam_getinfo',
  mail_claimallattachmentresp: 'mail_claimallattachment',
  store_buyresp: 'store_purchase',
  system_getdatabundleverresp: 'system_getdatabundlever',
  tower_claimrewardresp: 'tower_claimreward',
  fight_starttowerresp: 'fight_starttower',
  evotowerinforesp: 'evotower_getinfo',
  evotower_fightresp: 'evotower_fight',
  evotower_getlegionjoinmembersresp: 'evotower_getlegionjoinmembers',
  mergeboxinforesp: 'mergebox_getinfo',
  mergebox_claimfreeenergyresp: 'mergebox_claimfreeenergy',
  mergebox_openboxresp: 'mergebox_openbox',
  mergebox_automergeitemresp: 'mergebox_automergeitem',
  mergebox_mergeitemresp: 'mergebox_mergeitem',
  mergebox_claimcostprogressresp: 'mergebox_claimcostprogress',
  mergebox_claimmergeprogressresp: 'mergebox_claimmergeprogress',
  evotower_claimtaskresp: 'evotower_claimtask',
  item_openpackresp: 'item_openpack',
  equipment_quenchresp: 'equipment_quench',
  rank_getserverrankresp: 'rank_getserverrank',
  legion_claimpayloadtaskresp: 'legion_claimpayloadtask',
  legion_claimpayloadtaskprogressresp: 'legion_claimpayloadtaskprogress',
  saltroad_getwartyperesp: 'saltroad_getwartype',
  saltroad_getsaltroadwartotalrankresp: 'saltroad_getsaltroadwartotalrank',
  warguess_getrankresp: 'warguess_getrank',
  warguess_startguessresp: 'warguess_startguess',
  warguess_getguesscoinrewardresp: 'warguess_getguesscoinreward',
  league_getbattlefieldresp: 'league_getbattlefield',
  league_getgroupopponentresp: 'league_getgroupopponent',
  legion_signupresp: 'legion_signup',
  legion_payloadsignupresp: 'legion_payloadsignup',
  pearl_replaceskillresp: 'pearl_replaceskill',
  pearl_exchangeskillresp: 'pearl_exchangeskill',
  pearl_unloadskillresp: 'pearl_unloadskill',
  matchteam_getroleteaminforesp: 'matchteam_getroleteaminfo',
  bosstower_getinforesp: 'bosstower_getinfo',
  bosstower_startbossresp: 'bosstower_startboss',
  bosstower_startboxresp: 'bosstower_startbox',
  discount_getdiscountinforesp: 'discount_getdiscountinfo',
  hero_heroupgradestarresp: 'hero_heroupgradestar',
  hero_heroupgradelevelresp: 'hero_heroupgradelevel',
  hero_heroupgradeorderresp: 'hero_heroupgradeorder',
  book_upgraderesp: 'book_upgrade',
  book_claimpointrewardresp: 'book_claimpointreward',
  legion_getinforesp: 'legion_getinfo',
  legion_getinforresp: 'legion_getinfo',
  car_getrolecarresp: 'car_getrolecar',
  car_refreshresp: 'car_refresh',
  car_claimresp: 'car_claim',
  car_sendresp: 'car_send',
  car_getmemberhelpingcntresp: 'car_getmemberhelpingcnt',
  car_getmemberrankresp: 'car_getmemberrank',
  car_researchresp: 'car_research',
  car_claimpartconsumerewardresp: 'car_claimpartconsumereward',
  role_gettargetteamresp: 'role_gettargetteam',
  activity_warorderclaimresp: 'activity_recyclewarorderrewardclaim',
  bosstower_gethelprankresp: 'bosstower_gethelprank',
  legacy_getinforesp: 'legacy_getinfo',
  legacy_claimhangupresp: 'legacy_claimhangup',
  legacy_sendgiftresp: 'legacy_sendgift',
  legacy_getgiftsresp: 'legacy_getgifts',
  saltcup26_getbetinforesp: 'saltcup26_getbetinfo',
  saltcup26_placebetresp: 'saltcup26_placebet',
  activity_takeegamerewardresp: 'activity_startactegame',
  towers_getinforesp: 'towers_getinfo',
  towers_startresp: 'towers_start',
  towers_fightresp: 'towers_fight',
  task_claimdailyrewardresp: 'task_claimdailyreward',
  task_claimweekrewardresp: 'task_claimweekreward',
  gacha_drawrewardresp: 'gacha_drawreward',

  // 多命令映射
  legion_researchresp: ['legion_research', 'legion_resetresearch'],
  syncresp: [
    'system_mysharecallback',
    'task_claimdailypoint',
    'role_commitpassword',
    'hero_gointobattle',
    'hero_gobackbattle',
    'lordweapon_changedefaultweapon',
  ],
  syncrewardresp: [
    'system_buygold',
    'discount_claimreward',
    'card_claimreward',
    'artifact_lottery',
    'genie_sweep',
    'genie_buysweep',
    'system_signinreward',
    'dungeon_selecthero',
    'artifact_exchange',
    'hero_exchange',
    'hero_rebirth',
  ],
};

// ─────────────────────────── CommandRegistry ───────────────────────────

class CommandRegistry {
  constructor(encoder, enc) {
    this.encoder = encoder;
    this.enc = enc;
    this.commands = new Map();
  }

  register(cmd, defaultBody = {}, options = {}) {
    this.commands.set(cmd, (ack = 0, seq = 0, params = {}) => ({
      cmd,
      ack,
      seq,
      time: Date.now(),
      body: options.rawBody
        ? { ...defaultBody, ...params }
        : this.encoder?.bon?.encode
          ? this.encoder.bon.encode({ ...defaultBody, ...params })
          : { ...defaultBody, ...params },
    }));
    return this;
  }

  registerHeartbeat() {
    this.commands.set('heart_beat', (ack, seq) => ({
      cmd: '_sys/ack',
      ack,
      seq,
      time: Date.now(),
      body: {},
    }));
    return this;
  }

  encodePacket(raw) {
    if (this.encoder?.encode && this.enc) {
      return this.encoder.encode(raw, this.enc);
    }
    return JSON.stringify(raw);
  }

  build(cmd, ack, seq, params) {
    const fn = this.commands.get(cmd);
    if (!fn) throw new Error(`Unknown cmd: ${cmd}`);
    return fn(ack, seq, params);
  }
}

// ─────────────────────────── registerDefaultCommands ───────────────────────────

function registerDefaultCommands(reg) {
  const registry = reg
    .registerHeartbeat()
    // 角色/系统
    .register('role_getroleinfo', {
      clientVersion: '2.21.2-fa918e1997301834-wx',
      inviteUid: 0,
      platform: 'hortor',
      platformExt: 'mix',
      scene: '',
    })
    .register('system_getdatabundlever', { isAudit: false })
    .register('system_buygold', { buyNum: 1 })
    .register('system_claimhangupreward')
    .register('system_hangupupgrade', { upgradeNum: 1 })
    .register('system_signinreward')
    .register('system_mysharecallback', { isSkipShareCard: true, type: 2 })
    .register('system_custom', { key: '', value: 0 })

    // 任务
    .register('task_claimdailypoint', { taskId: 1 })
    .register('task_claimdailyreward', { rewardId: 0 })
    .register('task_claimweekreward', { rewardId: 0 })

    // 好友/招募
    .register('friend_batch', { friendId: 0 })
    .register('hero_recruit', { byClub: false, recruitNumber: 1, recruitType: 3 })
    .register('item_openbox', { itemId: 2001, number: 10 })
    .register('item_batchclaimboxpointreward')
    .register('item_openpack')
    .register('item_consume')
    .register('rank_getserverrank')

    // 竞技场
    .register('arena_startarea')
    .register('arena_getareatarget', { refresh: false })
    .register('arena_getarearank')

    // 战斗
    .register('fight_startlevel')
    .register('fight_calcleveltime')
    .register('fight_level', {}, { rawBody: true })
    .register('fight_startboss')
    .register('fight_startlegionboss')
    .register('fight_starttower')
    .register('fight_startdungeon')
    .register('fight_startpvp')

    // 商店
    .register('store_goodslist', { storeId: 1 })
    .register('store_buy', { goodsId: 1 })
    .register('store_purchase', { goodsId: 1 })
    .register('store_refresh', { storeId: 1 })

    // 军团
    .register('legion_getinfo')
    .register('legion_signin')
    .register('legion_storebuygoods')
    .register('legionwar_getdetails')

    // 邮件
    .register('mail_getlist', { category: [0, 4, 5], lastId: 0, size: 60 })
    .register('mail_claimallattachment', { category: 0 })

    // 学习问答
    .register('study_startgame')
    .register('study_answer')
    .register('study_claimreward', { rewardId: 1 })

    // 瓶子机器人
    .register('bottlehelper_claim')
    .register('bottlehelper_start', { bottleType: -1 })
    .register('bottlehelper_stop', { bottleType: -1 })

    // 钓鱼
    .register('artifact_lottery', { lotteryNumber: 1, newFree: true, type: 1 })
    .register('artifact_exchange')
    .register('artifact_load')
    .register('artifact_unload')

    // 灯神
    .register('genie_sweep', { genieId: 1 })
    .register('genie_buysweep')

    // 礼包
    .register('discount_claimreward', { discountId: 1 })
    .register('collection_claimfreereward')
    .register('collection_goodslist')
    .register('card_claimreward', { cardId: 1 })

    // 阵容
    .register('presetteam_getinfo')
    .register('presetteam_setteam')
    .register('presetteam_saveteam', { teamId: 1 })
    .register('role_gettargetteam')

    // 塔
    .register('tower_getinfo')
    .register('tower_claimreward')

    // 车辆
    .register('car_getrolecar')
    .register('car_refresh', { carId: 0 })
    .register('car_claim', { carId: 0 })
    .register('car_send', { carId: 0, helperId: 0, text: '' })
    .register('car_research')

    // 功法
    .register('legacy_getinfo')
    .register('legacy_claimhangup')

    // 扭蛋
    .register('gacha_drawreward', { num: 1, isGroup: false })

    // 梦魇
    .register('dungeon_selecthero')

    // 聊天
    .register('system_sendchatmessage')

    // 活动/通行证
    .register('activity_recyclewarorderrewardclaim')

    // 怪异咸将塔
    .register('evotower_getinfo')
    .register('evotower_fight')
    .register('evotower_claimreward')
    .register('evotower_claimtask', { taskId: 1 })

    // 咸王宝库
    .register('bosstower_getinfo')
    .register('bosstower_startboss')
    .register('bosstower_startbox')

    // 武将升级
    .register('hero_heroupgradelevel')
    .register('hero_heroupgradeorder')
    .register('hero_heroupgradestar')
    .register('hero_rebirth')
    .register('hero_gointobattle')
    .register('hero_gobackbattle')
    .register('hero_exchange')

    // 装备淬炼
    .register('equipment_quench', { heroId: 0, part: 0, quenchId: 0, quenches: {}, seed: 0, skipOrange: false })
    .register('equipment_confirm', { heroId: 0, part: 0, quenchId: 0, quenches: {} })
    .register('equipment_updatequenchlock', { heroId: 0, part: 0, slot: 0, isLocked: false })

    // 武器/密码
    .register('lordweapon_changedefaultweapon')
    .register('role_commitpassword', { password: '', passwordType: 1 });

  // fight_startareaarena — 需要 targetId
  registry.commands.set('fight_startareaarena', (ack = 0, seq = 0, params = {}) => {
    if (params?.targetId === undefined || params?.targetId === null) {
      throw new Error('fight_startareaarena requires targetId in params');
    }
    const payload = { ...params };
    const body = registry.encoder?.bon?.encode
      ? registry.encoder.bon.encode(payload)
      : payload;
    return { cmd: 'fight_startareaarena', ack, seq, time: Date.now(), body };
  });

  // fight_startpvp — 自定义
  registry.commands.set('fight_startpvp', (ack = 0, seq = 0, params = {}) => {
    const payload = { ...params };
    const body = registry.encoder?.bon?.encode
      ? registry.encoder.bon.encode(payload)
      : payload;
    return { cmd: 'fight_startpvp', ack, seq, time: Date.now(), body };
  });

  return registry;
}

// ─────────────────────────── GameWebSocketClient ───────────────────────────

class GameWebSocketClient {
  constructor({ url, heartbeatMs = 5000 }) {
    this.url = url;
    this.enc = g_utils.getEnc('auto');

    this.socket = null;
    this.ack = 0;
    this.seq = 0;
    this.sendQueue = [];
    this.sendQueueTimer = null;
    this.heartbeatTimer = null;
    this.heartbeatInterval = heartbeatMs;
    this.connected = false;
    this.isReconnecting = false;
    this.autoReconnect = false; // 默认关闭，由 ConnectionManager 按需开启

    this.promises = Object.create(null);
    this.registry = registerDefaultCommands(
      new CommandRegistry(g_utils, this.enc),
    );

    // 事件回调
    this.onConnect = null;
    this.onDisconnect = null;
    this.onMessage = null;
    this.onError = null;
  }

  /** 初始化连接 */
  init() {
    const urlPreview = this.url.split('?')[0];
    console.log(`[GameWS] 连接: ${urlPreview}`);

    this.socket = new WebSocket(this.url);

    this.socket.on('open', () => {
      console.log('[GameWS] 连接成功');
      this.connected = true;
      this._setupHeartbeat();
      this._processQueueLoop();
      if (this.onConnect) this.onConnect();
    });

    this.socket.on('message', (data) => {
      try {
        let packet;
        if (typeof data === 'string') {
          packet = JSON.parse(data);
        } else {
          // Buffer → ArrayBuffer → parse
          const buf = data instanceof Buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data;
          packet = g_utils.parse(buf, 'auto');
        }

        // 更新 ack
        const actualPacket = packet._raw || packet;
        const incomingSeq = typeof actualPacket?.seq === 'number'
          ? actualPacket.seq
          : typeof packet?.seq === 'number'
            ? packet.seq
            : undefined;
        if (typeof incomingSeq === 'number' && incomingSeq >= 0) {
          this.ack = incomingSeq;
        }

        // 消息回调
        if (this.onMessage) this.onMessage(packet);

        // Promise 响应
        this._handlePromiseResponse(packet);
      } catch (err) {
        console.error('[GameWS] 消息处理失败:', err.message);
      }
    });

    this.socket.on('close', (code, reason) => {
      console.log(`[GameWS] 连接关闭: ${code} ${reason || ''}`);
      this.connected = false;
      this._clearTimers();

      // 被踢/断线检测：游戏服务器断开连接后不应重连
      // 1006=异常关闭（服务器踢人/玩家登录顶号）、4xxx=应用层关闭、reason含关键词
      const reasonStr = reason?.toString() || '';
      const isKicked = code === 1006 || code >= 4000 || /kick|login|replace|duplicate/i.test(reasonStr);
      if (isKicked) {
        console.log(`[GameWS] 连接断开，不重连: code=${code} reason=${reasonStr}`);
        this.autoReconnect = false;
        this.kickedInfo = { code, reason: reasonStr, time: new Date().toISOString() };
      }

      if (this.onDisconnect) this.onDisconnect({ code, reason: reason?.toString(), kicked: isKicked });
      if (this.autoReconnect && !this.isReconnecting) {
        this._scheduleReconnect();
      }
    });

    this.socket.on('error', (err) => {
      console.error('[GameWS] 错误:', err.message);
      this.connected = false;
      this._clearTimers();
      if (this.onError) this.onError(err);
    });
  }

  /** 断开连接 */
  disconnect() {
    this.autoReconnect = false;
    if (this.socket) {
      try { this.socket.close(); } catch (e) { /* ignore */ }
      this.socket = null;
    }
    this.connected = false;
    this._clearTimers();
    // 拒绝所有等待的 Promise
    for (const [id, p] of Object.entries(this.promises)) {
      p.reject(new Error('连接已关闭'));
      delete this.promises[id];
    }
  }

  /** 重连 */
  reconnect() {
    if (this.isReconnecting) return;
    this.isReconnecting = true;
    console.log('[GameWS] 开始重连...');

    // 断开但保留 autoReconnect 状态
    const prevAutoReconnect = this.autoReconnect;
    if (this.socket) {
      try { this.socket.close(); } catch (e) { /* ignore */ }
      this.socket = null;
    }
    this.connected = false;
    this._clearTimers();
    this.autoReconnect = prevAutoReconnect;

    setTimeout(() => {
      try {
        this.init();
      } finally {
        setTimeout(() => { this.isReconnecting = false; }, 2000);
      }
    }, 1000);
  }

  /** 发送消息（入队） */
  send(cmd, params = {}, options = {}) {
    if (!this.connected) {
      console.warn(`[GameWS] 未连接，消息入队: ${cmd}`);
      if (!this.isReconnecting && this.autoReconnect) {
        this.reconnect();
      }
    }

    const assignedSeq = options.seq !== undefined
      ? options.seq
      : cmd === 'heart_beat' ? 0 : ++this.seq;

    const task = {
      cmd,
      params,
      seq: assignedSeq,
      respKey: options.respKey || cmd,
      sleep: options.sleep || 0,
      onSent: options.onSent,
    };
    this.sendQueue.push(task);
    return task;
  }

  /** Promise 版发送 */
  sendWithPromise(cmd, params = {}, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      if (!this.connected && !this.socket) {
        return reject(new Error('WebSocket 连接已关闭'));
      }

      const requestSeq = ++this.seq;
      this.promises[requestSeq] = { resolve, reject, originalCmd: cmd };

      const timer = setTimeout(() => {
        if (this.promises[requestSeq]) {
          delete this.promises[requestSeq];
          reject(new Error(`请求超时: ${cmd} (${timeoutMs}ms)`));
        }
      }, timeoutMs);

      // 响应匹配后清理 timer
      const origResolve = resolve;
      const origReject = reject;
      this.promises[requestSeq] = {
        resolve: (v) => { clearTimeout(timer); origResolve(v); },
        reject: (e) => { clearTimeout(timer); origReject(e); },
        originalCmd: cmd,
      };

      this.send(cmd, params, { seq: requestSeq });
    });
  }

  /** 发送心跳 */
  sendHeartbeat() {
    this.send('heart_beat', {}, { respKey: '_sys/ack' });
  }

  /** 获取角色信息 */
  getRoleInfo(params = {}) {
    return this.sendWithPromise('role_getroleinfo', params);
  }

  // ─────────── 内部方法 ───────────

  _setupHeartbeat() {
    setTimeout(() => {
      if (this.connected && this.socket?.readyState === WebSocket.OPEN) {
        this.sendHeartbeat();
      }
    }, 3000);

    this.heartbeatTimer = setInterval(() => {
      if (this.connected && this.socket?.readyState === WebSocket.OPEN) {
        this.sendHeartbeat();
      }
    }, this.heartbeatInterval);
  }

  _processQueueLoop() {
    if (this.sendQueueTimer) clearInterval(this.sendQueueTimer);

    this.sendQueueTimer = setInterval(() => {
      if (!this.sendQueue.length) return;
      if (!this.connected || this.socket?.readyState !== WebSocket.OPEN) return;

      const task = this.sendQueue.shift();
      if (!task) return;

      try {
        const raw = this.registry.build(task.cmd, this.ack, task.seq, task.params);
        const bin = this.registry.encodePacket(raw);
        this.socket.send(bin);

        if (task.onSent) {
          try {
            task.onSent({
              respKey: task.respKey,
              cmd: task.cmd,
              seq: raw?.seq ?? task.seq,
              ack: raw?.ack ?? this.ack,
              time: raw?.time ?? Date.now(),
            });
          } catch (e) { /* ignore */ }
        }
      } catch (err) {
        console.error(`[GameWS] 发送失败: ${task.cmd}`, err.message);
      }
    }, 50);
  }

  _handlePromiseResponse(packet) {
    // 优先用 resp 字段匹配
    if (packet.resp !== undefined && this.promises[packet.resp]) {
      const promiseData = this.promises[packet.resp];
      delete this.promises[packet.resp];

      const responseBody = packet.rawData !== undefined
        ? packet.rawData
        : packet.decodedBody !== undefined
          ? packet.decodedBody
          : packet.body;

      if (packet.code === 0 || packet.code === undefined) {
        promiseData.resolve(responseBody || packet);
      } else {
        const errorDesc = errorCodeMap[packet.code] || packet.hint || '未知错误';
        promiseData.reject(new Error(`服务器错误: ${packet.code} - ${errorDesc}`));
      }
      return;
    }

    // 兼容基于命令名的匹配
    const cmd = packet.cmd;
    if (!cmd) return;
    const respCmdKey = typeof cmd === 'string' ? cmd.toLowerCase() : cmd;

    let originalCmds = responseToCommandMap[respCmdKey];
    if (!originalCmds) {
      originalCmds = [respCmdKey];
    } else if (typeof originalCmds === 'string') {
      originalCmds = [originalCmds];
    }

    for (const [requestId, promiseData] of Object.entries(this.promises)) {
      if (originalCmds.includes(promiseData.originalCmd)) {
        delete this.promises[requestId];

        const responseBody = packet.rawData !== undefined
          ? packet.rawData
          : packet.decodedBody !== undefined
            ? packet.decodedBody
            : packet.body;

        if (responseBody && typeof responseBody === 'object') {
          responseBody._originalCmd = promiseData.originalCmd;
        }

        if (packet.code === 0 || packet.code === undefined) {
          promiseData.resolve(responseBody || packet);
        } else {
          const errorDesc = errorCodeMap[packet.code] || packet.hint || '未知错误';
          promiseData.reject(new Error(`服务器错误: ${packet.code} - ${errorDesc}`));
        }
        break;
      }
    }
  }

  _clearTimers() {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.sendQueueTimer) { clearInterval(this.sendQueueTimer); this.sendQueueTimer = null; }
  }

  _scheduleReconnect() {
    if (!this.autoReconnect) return;
    console.log('[GameWS] 5 秒后自动重连...');
    setTimeout(() => {
      if (!this.connected && this.autoReconnect) {
        this.reconnect();
      }
    }, 5000);
  }
}

module.exports = { GameWebSocketClient, CommandRegistry, registerDefaultCommands, errorCodeMap, responseToCommandMap };
