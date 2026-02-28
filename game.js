// 派戰 PaiZhan - 單機 Web 版
// 模式：故事模式（4P 你vs3AI）、二人對戰（2P 兩個人）、四人對戰（4P 你vs3AI）
// 技能：依《派系技能設定》落地（6 派，每派 2 招）

// 用 var 避免 VS Code Live Server / Hot Reload 重複注入 script 時出現「Identifier 'VERSION' has already been declared」
var VERSION = '0.5.0';

// ---------- 基本工具 ----------
function $(id){ return document.getElementById(id); }
function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
function clone(obj){ return JSON.parse(JSON.stringify(obj)); }

function shuffle(arr){
	for(let i=arr.length-1;i>0;i--){
		const j = Math.floor(Math.random()*(i+1));
		[arr[i],arr[j]] = [arr[j],arr[i]];
	}
	return arr;
}

function pickRandom(arr){
	return arr[Math.floor(Math.random()*arr.length)];
}

// ---------- 設定 ----------
const settings = {
	sfx: true,
	music: true,
	aiLevel: 'expert', // basic | advanced | expert
	speed: 'normal', // fast | normal | slow
	// mp3 音檔（放喺專案根目錄 /sfx/）
	// 背景音樂：支援 background-musicXX.mp3（例如 background-music02.mp3），每次返回主頁會隨機揀一首
	bgmUrl: 'sfx/background-music.mp3',
	bgmPickedUrl: null,
	sfxPlayUrl: 'sfx/community-cards-thrown.mp3',
	sfxUiUrl: 'sfx/sword-cut-type.mp3',
};

function speedMs(){
	if(settings.speed==='fast') return 220;
	if(settings.speed==='slow') return 700;
	return 450;
}
// AI 動作節奏：加少少隨機延遲，更似真人
function aiThinkDelayMs(){
	// 你要求：要「iPhone 咁順滑」—所以 AI 只係輕微慢少少
	// 基礎延遲：比 speedMs 慢一點點
	const base = speedMs() + 60;
	// 隨機：0.06s ~ 0.22s（真人感，但唔拖慢節奏）
	const jitter = 60 + Math.floor(Math.random()*160);
	return base + jitter;
}

// ---------- 音效引擎（WebAudio：更接近真實） ----------
// 另外亦支援 mp3：背景音樂 + SFX（出牌/按鍵）
let bgmEl = null;
let sfxPlayEl = null;
let sfxUiEl = null;
// 背景音樂：自動掃 background-musicXX.mp3（最多試 1..20）
async function pickRandomBgmUrl(){
	const candidates = [];
	candidates.push('sfx/background-music.mp3');
	candidates.push('sfx/background-music01.mp3');
	for(let i=2;i<=20;i++){
		candidates.push(`sfx/background-music${String(i).padStart(2,'0')}.mp3`);
	}
	const exist = [];
	for(const url of candidates){
		try{
			const res = await fetch(url, { method:'HEAD', cache:'no-store' });
			if(res && res.ok) exist.push(url);
		}catch(e){}
	}
	if(!exist.length) return 'sfx/background-music.mp3';
	return exist[Math.floor(Math.random()*exist.length)];
}
async function ensureAudioEls(){
	if(!bgmEl){
		bgmEl = new Audio(settings.bgmPickedUrl || settings.bgmUrl);
		bgmEl.loop = true;
		bgmEl.preload = 'auto';
		bgmEl.volume = 0.35;
	}
	if(!sfxPlayEl){
		sfxPlayEl = new Audio(settings.sfxPlayUrl);
		sfxPlayEl.preload = 'auto';
		sfxPlayEl.volume = 0.7;
	}
	if(!sfxUiEl){
		sfxUiEl = new Audio(settings.sfxUiUrl);
		sfxUiEl.preload = 'auto';
		sfxUiEl.volume = 0.55;
	}
}
function stopBgmMp3(){
	if(!bgmEl) return;
	try{ bgmEl.pause(); }catch(e){}
	try{ bgmEl.currentTime = 0; }catch(e){}
}
async function startBgmMp3(){
	if(!settings.music) return;
	await ensureAudioEls();
	try{ bgmEl.currentTime = 0; }catch(e){}
	const p = bgmEl.play();
	// 避免未解鎖時噴錯（unlockAudioOnce 會再叫 refreshMusic）
	if(p && p.catch) p.catch(()=>{});
}
function playMp3Sfx(el, maxMs){
	if(!settings.sfx) return;
	ensureAudioEls();
	try{
		el.pause();
		el.currentTime = 0;
		const p = el.play();
		if(p && p.catch) p.catch(()=>{});
		if(maxMs){
			setTimeout(()=>{ try{ el.pause(); }catch(e){} }, maxMs);
		}
	}catch(e){}
}
let audioCtx = null;
let musicState = { running:false, master:null, drone:null, noise:null };
let victoryMusicState = { running:false, master:null, seq:[] };
function getAudioCtx(){
	if(!audioCtx){
		audioCtx = new (window.AudioContext || window.webkitAudioContext)();
	}
	return audioCtx;
}
function tone(freq, type, durMs, gain, when=0){
	const ctx = getAudioCtx();
	const t0 = ctx.currentTime + when;
	const o = ctx.createOscillator();
	const g = ctx.createGain();
	o.type = type;
	o.frequency.setValueAtTime(freq, t0);
	g.gain.setValueAtTime(0.0001, t0);
	g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
	g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs/1000);
	o.connect(g); g.connect(ctx.destination);
	o.start(t0);
	o.stop(t0 + durMs/1000 + 0.03);
}
function noiseBurst(durMs, gain, hp=900){
	const ctx = getAudioCtx();
	const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * (durMs/1000)));
	const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
	const data = buffer.getChannelData(0);
	for(let i=0;i<bufferSize;i++) data[i] = (Math.random()*2-1);
	const src = ctx.createBufferSource();
	src.buffer = buffer;
	const filter = ctx.createBiquadFilter();
	filter.type = 'highpass';
	filter.frequency.value = hp;
	const g = ctx.createGain();
	g.gain.value = gain;
	src.connect(filter); filter.connect(g); g.connect(ctx.destination);
	src.start();
}
function startMusic(){
	if(!settings.music) return;
	const ctx = getAudioCtx();
	if(musicState.running) return;
	musicState.running = true;
	const master = ctx.createGain();
	master.gain.value = 0.03;
	master.connect(ctx.destination);
	musicState.master = master;
	// 低頻 drone（軍帳氛圍）
	const d = ctx.createOscillator();
	d.type = 'sine';
	d.frequency.value = 55;
	const dg = ctx.createGain();
	dg.gain.value = 0.9;
	d.connect(dg); dg.connect(master);
	d.start();
	musicState.drone = d;
	// 高頻風噪（很輕）
	const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
	const data = buffer.getChannelData(0);
	for(let i=0;i<data.length;i++) data[i] = (Math.random()*2-1);
	const n = ctx.createBufferSource();
	n.buffer = buffer;
	n.loop = true;
	const nf = ctx.createBiquadFilter();
	nf.type = 'lowpass';
	nf.frequency.value = 750;
	const ng = ctx.createGain();
	ng.gain.value = 0.25;
	n.connect(nf); nf.connect(ng); ng.connect(master);
	n.start();
	musicState.noise = n;
}
function stopMusic(){
	if(!musicState.running) return;
	musicState.running = false;
	try{ musicState.drone?.stop?.(); }catch(e){}
	try{ musicState.noise?.stop?.(); }catch(e){}
	try{ musicState.master?.disconnect?.(); }catch(e){}
	musicState = { running:false, master:null, drone:null, noise:null };
}
async function refreshMusic(){
	// 背景音樂只喺「主頁」播放（你要求：遊戲中唔播）
	const shouldPlay = settings.music && state.screen==='title';
	if(shouldPlay){
		// 每次回到主頁：隨機揀一首 background-music(XX)
		try{
			const picked = await pickRandomBgmUrl();
			if(picked && picked!==settings.bgmPickedUrl){
				settings.bgmPickedUrl = picked;
				if(bgmEl){
					try{ bgmEl.pause(); }catch(e){}
					bgmEl = null;
				}
			}
		}catch(e){}
		await startBgmMp3();
		startMusic();
	} else {
		stopBgmMp3();
		stopMusic();
	}
}
// ---- AudioContext：避免 Console 黃色警告 ----
// 瀏覽器限制：AudioContext 只能喺「用戶手勢」之後 start/resume。
let _audioUnlocked = false;
function unlockAudioOnce(){
	if(_audioUnlocked) return;
	_audioUnlocked = true;
	try{
		const ctx = getAudioCtx();
		if(ctx && ctx.state==='suspended') ctx.resume();
	}catch(e){}
	refreshMusic();
	try{ window.removeEventListener('pointerdown', unlockAudioOnce, true); }catch(e){}
	try{ window.removeEventListener('keydown', unlockAudioOnce, true); }catch(e){}
}
// ---------- 勝利音樂（短旋律 + 低頻鼓點） ----------
function stopVictoryMusic(){
	if(!victoryMusicState.running) return;
	victoryMusicState.running = false;
	try{ victoryMusicState.seq.forEach(n=>{ try{ n.stop?.(); }catch(e){} }); }catch(e){}
	try{ victoryMusicState.master?.disconnect?.(); }catch(e){}
	victoryMusicState = { running:false, master:null, seq:[] };
}
function playVictoryMusic(){
	if(!settings.music) return;
	const ctx = getAudioCtx();
	stopVictoryMusic();
	victoryMusicState.running = true;
	const master = ctx.createGain();
	master.gain.value = 0.06;
	master.connect(ctx.destination);
	victoryMusicState.master = master;
	const now = ctx.currentTime;
	const notes = [
		{ f: 523.25, t: 0.00, d: 0.18 }, // C5
		{ f: 659.25, t: 0.20, d: 0.18 }, // E5
		{ f: 783.99, t: 0.40, d: 0.22 }, // G5
		{ f: 1046.50, t: 0.65, d: 0.35 }, // C6
		{ f: 987.77, t: 1.05, d: 0.22 }, // B5
		{ f: 1046.50, t: 1.30, d: 0.40 }, // C6
	];
	// 鼓點（低頻）
	const kicks = [0.00, 0.40, 0.65, 1.05, 1.30];
	kicks.forEach((tt)=>{
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		o.type = 'sine';
		o.frequency.setValueAtTime(90, now+tt);
		o.frequency.exponentialRampToValueAtTime(45, now+tt+0.12);
		g.gain.setValueAtTime(0.0001, now+tt);
		g.gain.exponentialRampToValueAtTime(0.35, now+tt+0.01);
		g.gain.exponentialRampToValueAtTime(0.0001, now+tt+0.14);
		o.connect(g); g.connect(master);
		o.start(now+tt);
		o.stop(now+tt+0.18);
		victoryMusicState.seq.push(o);
	});
	notes.forEach(n=>{
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		o.type = 'triangle';
		o.frequency.setValueAtTime(n.f, now+n.t);
		g.gain.setValueAtTime(0.0001, now+n.t);
		g.gain.exponentialRampToValueAtTime(0.22, now+n.t+0.01);
		g.gain.exponentialRampToValueAtTime(0.0001, now+n.t+n.d);
		o.connect(g); g.connect(master);
		o.start(now+n.t);
		o.stop(now+n.t+n.d+0.02);
		victoryMusicState.seq.push(o);
	});
	// 2 秒後自動停止（避免持續佔用）
	setTimeout(()=> stopVictoryMusic(), 2200);
}
function playSfx(kind){
	if(!settings.sfx) return;
	try{
		// mp3 SFX（優先）
		if(kind==='play'){
			playMp3Sfx(sfxPlayEl || (ensureAudioEls(), sfxPlayEl), 3000); // 只播頭 3 秒
			return;
		}
		if(kind==='ui'){
			playMp3Sfx(sfxUiEl || (ensureAudioEls(), sfxUiEl));
			return;
		}
		// pass / deal：暫時仍用 WebAudio（夠清晰、亦唔需要音檔）
		if(kind==='pass'){
			noiseBurst(90, 0.03, 650);
			tone(190, 'sine', 110, 0.05);
			return;
		}
		if(kind==='deal'){
			noiseBurst(30, 0.02, 1800);
			tone(980, 'square', 45, 0.015);
			return;
		}
	}catch(e){ /* ignore */ }
}

// ---------- 牌組 ----------
const SUITS = [
	{ key: 'S', name: '♠', rank: 4 },
	{ key: 'H', name: '♥', rank: 3 },
	{ key: 'C', name: '♣', rank: 2 },
	{ key: 'D', name: '♦', rank: 1 },
];

const RANKS = [
	{ face: '2', v: 2 }, { face: '3', v: 3 }, { face: '4', v: 4 }, { face: '5', v: 5 },
	{ face: '6', v: 6 }, { face: '7', v: 7 }, { face: '8', v: 8 }, { face: '9', v: 9 },
	{ face: '10', v: 10 }, { face: 'J', v: 11 }, { face: 'Q', v: 12 }, { face: 'K', v: 13 }, { face: 'A', v: 14 },
];

function buildDeck(){
	const deck = [];
	for(const s of SUITS){
		for(const r of RANKS){
			deck.push({ suit: s.key, suitRank: s.rank, rank: r.v, face: r.face });
		}
	}
	return shuffle(deck);
}

function suitSymbol(k){ return SUITS.find(s=>s.key===k).name; }
function cardLabel(c){ return `${c.face}${suitSymbol(c.suit)}`; }
function rankFace(v){ return RANKS.find(r=>r.v===v)?.face ?? String(v); }

function sortHand(hand){
	hand.sort((a,b)=> (a.rank-b.rank) || (a.suitRank-b.suitRank));
}

// ---------- 圖片資源（assets） ----------
const CARD_IMG_DIR = 'assets/cards';
// 你而家已將 J/Q/K 檔名的 2 後綴刪除，所以全部牌一律用「無後綴」命名。
const FACE_CARD_SUFFIX = '';
// 你而家牌圖仍然 404（例如 king_of_clubs.png），好大機會係副檔名大小寫唔一致。
// 你呢套資源（見你截圖）檔名可能係「無副檔名」或被 Windows 隱藏副檔名。
// 你確認 black_joker.PNG 打得開，但而家 J/Q/K（例如 jack_of_spades）仍然 404。
// 代表你套 assets 可能混合了 .PNG / .png（或部分檔案係另一種大小寫）。
// 先收斂到只試兩個：.PNG + .png，避免再試 jpg/webp。
const IMG_EXTS = ['.PNG', '.png'];

// --- 404 降噪：用快取 + HEAD 檢查，避免不停嘗試不存在資源造成 console 紅字 ---
const _imgResolveCache = new Map(); // key: src string, value: true/false
const _imgListCache = new Map(); // key: joined list, value: resolved src or null
async function _urlExists(url){
	if(_imgResolveCache.has(url)) return _imgResolveCache.get(url);
	// 部分本地 server 對 HEAD 支援唔完整，所以用：先 HEAD，唔得就 GET（只取 headers）
	try{
		let res = await fetch(url, { method:'HEAD', cache:'no-store' });
		if(res && res.ok){
			_imgResolveCache.set(url, true);
			return true;
		}
		// fallback: GET
		res = await fetch(url, { method:'GET', cache:'no-store' });
		const ok = !!res && res.ok;
		_imgResolveCache.set(url, ok);
		return ok;
	}catch(e){
		_imgResolveCache.set(url, false);
		return false;
	}
}
async function resolveFirstExisting(srcList){
	const key = srcList.join('|');
	if(_imgListCache.has(key)) return _imgListCache.get(key);
	for(const url of srcList){
		const ok = await _urlExists(url);
		if(ok){
			_imgListCache.set(key, url);
			return url;
		}
	}
	_imgListCache.set(key, null);
	return null;
}
function tryLoadImage(imgEl, srcList, onAllFail){
	// 先清掉舊 handler（避免 live reload 重覆綁定）
	imgEl.onerror = null;
	resolveFirstExisting(srcList).then((hit)=>{
		if(hit){
			imgEl.src = hit;
			return;
		}
		// debug：只喺完全搵唔到時印一次，方便你對照實際檔名
		try{
			const key = srcList.join('|');
			if(!tryLoadImage._warned) tryLoadImage._warned = new Set();
			if(!tryLoadImage._warned.has(key)){
				tryLoadImage._warned.add(key);
				console.warn('[IMG] not found, tried:', srcList);
			}
		}catch(e){}
		if(onAllFail) onAllFail();
	});
}

function rankToFileName(rank){
	if(rank===14) return 'ace';
	if(rank===13) return 'king';
	if(rank===12) return 'queen';
	if(rank===11) return 'jack';
	return String(rank);
}
function suitToFileName(suitKey){
	return ({S:'spades', H:'hearts', C:'clubs', D:'diamonds'})[suitKey] || 'spades';
}
function cardImgCandidates(card, useVariant=true){
	const r = rankToFileName(card.rank);
	const s = suitToFileName(card.suit);
	// 你而家檔名全部無後綴：只需要試一次
	const bases = [`${CARD_IMG_DIR}/${r}_of_${s}`];
	const out = [];
	bases.forEach(base=> IMG_EXTS.forEach(ext=> out.push(base+ext)));
	return out;
}
function cardBackCandidates(){
	// 你新增咗牌背圖：card_back.jpg（優先用它），若搵唔到先 fallback 去 jokers。
	// 注意：card_back 同其他牌圖唔同，佢係 jpg。
	const bases = [
		`${CARD_IMG_DIR}/card_back.jpg`,
		`${CARD_IMG_DIR}/card_back.JPG`,
		`${CARD_IMG_DIR}/card_back.jpeg`,
		`${CARD_IMG_DIR}/card_back.JPEG`,
		`${CARD_IMG_DIR}/card_back`,
		`${CARD_IMG_DIR}/black_joker`,
		`${CARD_IMG_DIR}/red_joker`,
	];
	const out = [];
	bases.forEach(base=>{
		// 如果 base 已經有 .jpg/.jpeg 就直接用；否則用 IMG_EXTS 去補 .PNG/.png
		if(/\.(jpe?g)$/i.test(base)) out.push(base);
		else IMG_EXTS.forEach(ext=> out.push(base+ext));
	});
	return out;
}

// ---------- 牌型 ----------
const TYPE = {
	SINGLE: 1,
	PAIR: 2,
	STRAIGHT: 3,
	FLUSH: 4,
	FULLHOUSE: 5,
	STRAIGHTFLUSH: 6,
};

const TYPE_NAME = {
	[TYPE.SINGLE]: '單張',
	[TYPE.PAIR]: '對子',
	[TYPE.STRAIGHT]: '順子',
	[TYPE.FLUSH]: '同花',
	[TYPE.FULLHOUSE]: '葫蘆',
	[TYPE.STRAIGHTFLUSH]: '同花順',
};

function countByRank(cards){
	const m = new Map();
	for(const c of cards){ m.set(c.rank, (m.get(c.rank)||0)+1); }
	return m;
}

function isFlush(cards){
	if(cards.length!==5) return false;
	return cards.every(c=>c.suit===cards[0].suit);
}

function isStraight(cards){
	if(cards.length!==5) return false;
	const rs = [...new Set(cards.map(c=>c.rank))].sort((a,b)=>a-b);
	if(rs.length!==5) return false;
	return rs[4]-rs[0]===4;
}

function getMainSuitRank(cards){
	return Math.max(...cards.map(c=>c.suitRank));
}

function evaluatePlayBase(cards){
	const n = cards.length;
	const sorted = [...cards].sort((a,b)=> (a.rank-b.rank) || (a.suitRank-b.suitRank));

	if(n===1){
		return { ok:true, type:TYPE.SINGLE, mainRank:sorted[0].rank, tieSuitRank:sorted[0].suitRank, name: '單張' };
	}
	if(n===2){
		if(sorted[0].rank===sorted[1].rank){
			return { ok:true, type:TYPE.PAIR, mainRank:sorted[0].rank, tieSuitRank:getMainSuitRank(sorted), name:'對子' };
		}
		return { ok:false };
	}
	if(n===5){
		const flush = isFlush(sorted);
		const straight = isStraight(sorted);
		const counts = [...countByRank(sorted).entries()].sort((a,b)=> b[1]-a[1] || b[0]-a[0]);

		if(flush && straight){
			return { ok:true, type:TYPE.STRAIGHTFLUSH, mainRank:sorted[4].rank, tieSuitRank:getMainSuitRank(sorted), name:'同花順' };
		}
		if(counts[0][1]===3 && counts[1][1]===2){
			return { ok:true, type:TYPE.FULLHOUSE, mainRank:counts[0][0], tieSuitRank:getMainSuitRank(sorted), name:'葫蘆' };
		}
		if(flush){
			return { ok:true, type:TYPE.FLUSH, mainRank:sorted[4].rank, tieSuitRank:getMainSuitRank(sorted), name:'同花' };
		}
		if(straight){
			return { ok:true, type:TYPE.STRAIGHT, mainRank:sorted[4].rank, tieSuitRank:getMainSuitRank(sorted), name:'順子' };
		}
		return { ok:false };
	}
	return { ok:false };
}

function compareEval(a,b){
	if(!b) return true;
	if(b.type===TYPE.SINGLE || b.type===TYPE.PAIR){
		if(a.type !== b.type) return false;
		if(a.mainRank !== b.mainRank) return a.mainRank > b.mainRank;
		return a.tieSuitRank > b.tieSuitRank;
	}
	if(a.type !== b.type){
		if(a.type===TYPE.SINGLE || a.type===TYPE.PAIR) return false;
		return a.type > b.type;
	}
	if(a.mainRank !== b.mainRank) return a.mainRank > b.mainRank;
	return a.tieSuitRank > b.tieSuitRank;
}

// ---------- 派系 ----------
const FACTIONS = [
	{ key: 'steel', name: '🛡️ 鋼骨' },
	{ key: 'archer', name: '🏹 神機' },
	{ key: 'general', name: '⚔️ 飛將' },
	{ key: 'strategist', name: '📜 智囊' },
	{ key: 'abyss', name: '🌊 深淵' },
	{ key: 'thunder', name: '⚡ 雷鳴' },
];

// ---------- 故事模式（六章） ----------
const CHAPTERS = [
	{ key: 'ch1', title: '第一章：血月之夜', story: '血月升起，四色王冠破碎。\n碎片散落，派系割據。\n你踏入戰局，第一戰即將開始。' },
	{ key: 'ch2', title: '第二章：王冠碎片', story: '每一張牌，都像一塊碎片。\n有人用鐵與盾守住秩序。\n有人用機關與算計撕開缺口。' },
	{ key: 'ch3', title: '第三章：暗潮', story: '深淵在水面之下回響。\n順勢而為的人，總能等到下一波浪。' },
	{ key: 'ch4', title: '第四章：名門與權貴', story: '有人用號令改寫戰局。\n有人用家世交換你手中的關鍵。' },
	{ key: 'ch5', title: '第五章：計中計', story: '你以為你在計算對手。\n其實你只是走進另一個計算。' },
	{ key: 'ch6', title: '第六章：雷鳴將至', story: '當雷鳴落下，沉默亦成武器。\n你必須在 PASS 與出牌之間，搶到控場權。' },
];

// ---------- 遊戲狀態 ----------
const state = {
	screen: 'title',
	mode: 'free',
	chapterIndex: 0,
	players: [],
	turn: 0,
	lead: 0,
	pile: null,
	pileStack: [],
	passCount: 0,
	over: false,
	config: { players: 4 },
	lastStartConfig: null,
	turnTargetForPredation: null,
	skill: {
		trap: null, // { by, target, reduce, resumeTurn }
		emptyCity: new Set(), // players immune to active skills
		thunderForcePass: null, // { target }
		charge: {}, // thunder charge {pi:n}
		abyssFollowBuff: {}, // {pi:{active,stage}}
		wildcard: {}, // {pi:{idx}}
	},
};

function newPlayer(name, isHuman){
	const faction = clone(FACTIONS[Math.floor(Math.random()*FACTIONS.length)]);
	return {
		name,
		isHuman,
		faction,
		hand: [],
		selectedIdx: new Set(),
		used: {
			steelWall:false,
			archerTrap:false,
			generalDecree:false,
			generalHouse:false,
			strategistPlan:false,
			strategistCity:false,
			abyssSwallow:false,
			thunderFear:false,
		},
	};
}

// ---------- UI/Log ----------
function log(msg, kind=''){
	const el = $('log');
	if(!el) return;
	const div = document.createElement('div');
	div.className = 'item ' + kind;
	div.textContent = msg;
	el.prepend(div);
}

function setScreen(name){
	// 遊戲中背景圖：隨機揀 UI/war_tent_command1/2.jpg（你新增）
	if(name==='game'){
		try{
			const list = ['assets/ui/war_tent_command1.jpg','assets/ui/war_tent_command2.jpg'];
			const pick = list[Math.floor(Math.random()*list.length)];
			document.documentElement.style.setProperty('--gameBgImg', `url("${pick}")`);
		}catch(e){}
	}
	state.screen = name;
	$('screenTitle')?.classList.toggle('hidden', name!=='title');
	$('screenGame')?.classList.toggle('hidden', name!=='game');
	$('screenVictory')?.classList.toggle('hidden', name!=='victory');
	$('actionBar')?.classList.toggle('hidden', name!=='game');
	// 遊戲中：頂部欄自動收起（避免擋畫面）
	try{ document.body.classList.toggle('inGame', name==='game'); }catch(e){}
	// 2P 樣式切換（只影響 CSS，避免 4P 左上 AI 被套用 2P 的置中樣式）
	try{ document.body.classList.toggle('is2P', state.players.length===2); }catch(e){}
	// 勝利畫面：暫停背景音樂、播勝利音樂
	if(name==='victory'){
		try{ stopBgmMp3(); }catch(e){}
		try{ stopMusic(); }catch(e){}
		try{ playVictoryMusic(); }catch(e){}
	}
	// 主頁：恢復背景音樂；遊戲：確保 BGM 停止
	if(name==='title' || name==='game'){
		try{ stopVictoryMusic(); }catch(e){}
		refreshMusic();
	}
}

function currentChapter(){
	if(state.mode!=='story') return null;
	return CHAPTERS[clamp(state.chapterIndex, 0, CHAPTERS.length-1)];
}

function setStatus(){
	const hud1 = $('hudLine1');
	const hud2 = $('hudLine2');
	// 你要求：唔顯示長句 HUD，改為『輪到邊個』就亮燈
	if(hud1) hud1.textContent = '';
	if(hud2) hud2.textContent = '';
	const is2P = (state.players.length===2);
	// 2P 熱座位顯示：
	// - 底部 rowP0 永遠顯示「當前操作玩家」
	// - 上方 rowP1 永遠顯示「另一位玩家（牌蓋住）」
	const bottomPi = is2P ? state.turn : 0;
	const topPi = is2P ? (1 - bottomPi) : 1;
	// 輪到誰：亮燈（玩家名區塊）
	for(let i=0;i<4;i++){
		const row = $(i===0?'rowP0':i===1?'rowP1':i===2?'rowP2':'rowP3');
		if(!row) continue;
		if(is2P){
			if(i===0) row.classList.toggle('activeTurn', true);
			else if(i===1) row.classList.toggle('activeTurn', false);
			else row.classList.toggle('activeTurn', false);
		} else {
			row.classList.toggle('activeTurn', i===state.turn);
		}
	}
	// 血量（HP）：RPG bar（綠→黃→紅），用「剩餘手牌比例」表示
	const maxHand = state.initialHandSize || (is2P ? 20 : 13);
	const slotToPi = (slot)=>{
		if(!is2P) return slot;
		if(slot===0) return bottomPi;
		if(slot===1) return topPi;
		return slot;
	};
	for(let slot=0;slot<state.players.length;slot++){
		const pi = slotToPi(slot);
		const wrap = $(slot===0?'p0Hp':slot===1?'p1Hp':slot===2?'p2Hp':'p3Hp');
		if(!wrap) continue;
		const bar = wrap.querySelector?.('.hpFill');
		const txt = wrap.querySelector?.('.hpText');
		const cur = state.players[pi]?.hand?.length ?? 0;
		const ratio = clamp(cur / Math.max(1, maxHand), 0, 1);
		if(bar){
			bar.style.width = `${Math.round(ratio*100)}%`;
			bar.classList.toggle('low', ratio<=0.33);
			bar.classList.toggle('mid', ratio>0.33 && ratio<=0.66);
			bar.classList.toggle('high', ratio>0.66);
		}
		if(txt) txt.textContent = `${cur}/${maxHand}`;
		else wrap.textContent = `HP ${cur}`;
	}
}

function cardDiv(c, small=false, showFront=true){
	const d = document.createElement('div');
	d.className = 'card ' + (small ? 'small' : '');
	const img = document.createElement('img');
	img.className = 'cardImg';
	img.alt = showFront ? cardLabel(c) : '背面';
	if(showFront){
		// 先試：有 variant（例如 ...2.png），再試：無 variant（例如 ...png）
		const list = [...cardImgCandidates(c, true), ...cardImgCandidates(c, false)];
		tryLoadImage(img, list, ()=>{ img.remove(); d.textContent = cardLabel(c); });
	} else {
		tryLoadImage(img, cardBackCandidates(), ()=>{ img.remove(); d.textContent = '牌'; d.style.color = 'rgba(255,255,255,.6)'; });
	}
	d.appendChild(img);
	return d;
}

// ---------- 派系圖片（霸氣徽章） ----------
const FACTION_IMG_DIR = 'assets/factions';
// 你派系圖係 jpg，所以優先試 jpg/jpeg（大小寫都試），最後先試 png。
const FACTION_IMG_EXTS = ['.jpg', '.JPG', '.jpeg', '.JPEG', '.PNG', '.png'];
function factionImgCandidates(fkey){
	const base = `${FACTION_IMG_DIR}/${fkey}`;
	return FACTION_IMG_EXTS.map(ext=> base + ext);
}
const FACTION_SLOGAN = {
	steel: '盾守千軍，骨如鋼鐵',
	archer: '箭無虛發，機不可失',
	general: '金甲耀世，權勢無雙',
	strategist: '運籌帷幄，計定天下',
	abyss: '潮起潮落，順勢而為',
	thunder: '知識如雷，一擊制敵',
};
function setFactionLabel(elId, faction){
	const el = $(elId);
	if(!el) return;
	el.innerHTML = '';
	const badge = document.createElement('div');
	badge.className = 'factionBadge';
	const img = document.createElement('img');
	img.className = 'fimg';
	img.alt = faction.name;
	tryLoadImage(img, factionImgCandidates(faction.key), ()=>{ img.remove(); });
	badge.appendChild(img);
	const textWrap = document.createElement('div');
	const name = document.createElement('div');
	name.className = 'fname';
	name.textContent = faction.name;
	const tag = document.createElement('span');
	tag.className = 'tagline';
	tag.textContent = FACTION_SLOGAN[faction.key] || '戰旗已立';
	textWrap.appendChild(name);
	textWrap.appendChild(tag);
	badge.appendChild(textWrap);
	el.appendChild(badge);
}

// 2P 熱座位 + 4P 通用顯示（修正版本）
function renderHandSlot(slot){
	const is2P = (state.players.length===2);
	let actualPi = slot;
	let showFront = true;
	let allowClick = true;
	if(is2P){
		if(slot===0){ actualPi = state.turn; showFront = true; allowClick = true; }
		else if(slot===1){ actualPi = 1 - state.turn; showFront = false; allowClick = false; }
	}
	const p = state.players[actualPi];
	const el = $(slot===0?'p0Hand':slot===1?'p1Hand':slot===2?'p2Hand':'p3Hand');
	if(!el) return;
	el.innerHTML = '';
	if(!p) return;
	// 4P/故事：AI 顯示牌背占位
	if(!is2P && !p.isHuman){
		for(let i=0;i<p.hand.length;i++){
			const d = cardDiv({rank:2,suit:'D',face:'2',suitRank:1}, true, false);
			d.classList.add('hidden');
			el.appendChild(d);
		}
		return;
	}
	// 4P/故事：
	// - 玩家自己（你）手牌一直顯示正面（唔會因為輪到 AI 就蓋住）
	// - 點擊 handler 保持存在（避免某些渲染時機導致「點唔到」）
	// - 但只有輪到你回合先會真正變更 selected
	if(!is2P){
		if(state.players[actualPi]?.isHuman){
			showFront = true;
			allowClick = true;
		} else {
			showFront = (state.turn===actualPi);
			allowClick = showFront;
		}
	}
	const n = p.hand.length;
	const mid = (n - 1) / 2;
	p.hand.forEach((c, idx)=>{
		const d = cardDiv(c, false, showFront);
		if(slot===0){
			d.classList.add('handCard');
			d.style.setProperty('--i', idx);
			d.style.setProperty('--n', n);
			const t = (idx - mid) / Math.max(1, mid);
			const angle = t * 18;
			const x = t * 220;
			const y = (t*t) * 34;
			d.style.setProperty('--handAngle', angle + 'deg');
			d.style.setProperty('--handX', x + 'px');
			d.style.setProperty('--handY', y + 'px');
		}
		d.dataset.idx = String(idx);
		if(showFront && p.selectedIdx.has(idx)) d.classList.add('selected');
		if(allowClick){
			d.addEventListener('click', ()=>{
				if(state.over) return;
				if(!p.isHuman) return;
				// 4P：允許預先選牌，但只有輪到你回合先可以出牌
				// （避免出現「點唔到牌」的體驗問題）
				if(p.selectedIdx.has(idx)) p.selectedIdx.delete(idx);
				else p.selectedIdx.add(idx);
				d.classList.toggle('selected', p.selectedIdx.has(idx));
				renderSelected();
				updateButtons();
			});
		}
		el.appendChild(d);
	});
}
function renderHand(pi){
	const p = state.players[pi];
	const el = $(pi===0?'p0Hand':pi===1?'p1Hand':pi===2?'p2Hand':'p3Hand');
	if(!el) return;
	el.innerHTML = '';
	if(!p) return;

	if(!p.isHuman){
		for(let i=0;i<p.hand.length;i++){
			const d = cardDiv({rank:2,suit:'D',face:'2',suitRank:1}, true, false);
			d.classList.add('hidden');
			el.appendChild(d);
		}
		return;
	}

	// 非 2P：只喺自己回合先顯示正面、可操作
	if(!is2P){
		showFront = (state.turn===actualPi);
		allowClick = showFront;
	}
	const n = p.hand.length;
	const mid = (n - 1) / 2;
	p.hand.forEach((c, idx)=>{
		const d = cardDiv(c, false, showFront);
		// 扇形展開：只做喺底部手牌槽位（slot 0）
		if(slot===0){
			d.classList.add('handCard');
			d.style.setProperty('--i', idx);
			d.style.setProperty('--n', n);
						const t = (idx - mid) / Math.max(1, mid); // -1..1
			// 更似參考圖：整條手牌呈弧形（中間高、兩邊低），角度更明顯、左右更展開
			const angle = t * 18; // deg
			const x = t * 220; // px
			const y = (t*t) * 34; // px (用平方令兩邊更低)
			d.style.setProperty('--handAngle', angle + 'deg');
			d.style.setProperty('--handX', x + 'px');
			d.style.setProperty('--handY', y + 'px');
		}
		d.dataset.idx = String(idx);
		if(showFront && p.selectedIdx.has(idx)) d.classList.add('selected');
		if(allowClick) d.addEventListener('click', ()=>{
			if(state.over) return;
			if(!p.isHuman) return;
			if(p.selectedIdx.has(idx)) p.selectedIdx.delete(idx);
			else p.selectedIdx.add(idx);
			if(showFront) d.classList.toggle('selected', p.selectedIdx.has(idx));
			renderSelected();
			updateButtons();
		});
		el.appendChild(d);
	});
}

function renderSelected(){
	const cur = state.players[state.turn];
	const el = $('selected');
	if(!el) return;
	el.innerHTML='';

	if(!cur?.isHuman){
		const t = document.createElement('div');
		t.style.color = '#aab3dd';
		t.style.fontSize = '12px';
		t.textContent = '（輪到 AI）';
		el.appendChild(t);
		return;
	}

	const idxs = [...cur.selectedIdx].sort((a,b)=>a-b);
	for(const idx of idxs){ el.appendChild(cardDiv(cur.hand[idx], true, true)); }
	if(idxs.length===0){
		const t = document.createElement('div');
		t.style.color = '#aab3dd';
		t.style.fontSize = '12px';
		t.textContent = '尚未選擇牌。';
		el.appendChild(t);
	}
}

function formatComboTitle(pile){
	if(!pile?.eval) return '';
	const face = rankFace(pile.eval.mainRank);
	const tname = TYPE_NAME[pile.eval.type] || '';
	return `${face}${tname}`;
}
function renderCurrentPile(){
	const host = $('currentPile');
	if(!host) return;
	// 標題：顯示出牌組合名（取代「戰略桌」）
	try{
		const tt = $('tableTitle');
		if(tt) tt.textContent = state.pile ? formatComboTitle(state.pile) : '';
	}catch(e){}
	// 目標：iPhone 級「絲滑」
	// - 盡量唔重建整個 DOM（會閃 / 會卡）
	// - 只更新 row 內容
	// - 用 transition（而唔係 animation）做細微 fade
	let label = host.querySelector('.label');
	let row = host.querySelector('.row');
	let empty = host.querySelector('.empty');
	if(!label){
		label = document.createElement('div');
		label.className = 'label';
		label.textContent = '目前場上牌';
		host.appendChild(label);
	}
	// 清舊狀態
	host.classList.remove('pileIn');
	if(row){ row.remove(); row = null; }
	if(empty){ empty.remove(); empty = null; }
	if(!state.pile){
		empty = document.createElement('div');
		empty.className = 'empty';
		empty.textContent = '（場上無牌，可出任意牌型）';
		host.appendChild(empty);
		// 兩幀：確保 transition 生效
		requestAnimationFrame(()=> requestAnimationFrame(()=> host.classList.add('pileIn')));
		return;
	}
	row = document.createElement('div');
	row.className = 'row';
	const who = document.createElement('span');
	who.className = 'who';
	who.textContent = (state.players && state.pile && state.players[state.pile.by]) ? `${state.players[state.pile.by].name}：` : `P${state.pile.by}：`;
	row.appendChild(who);
	for(const c of (state.pile.cards || [])) row.appendChild(cardDiv(c, true, true));
	if(state.pile && state.pile.eval && state.pile.eval.buffText){
		const meta = document.createElement('span');
		meta.className = 'meta';
		meta.textContent = state.pile.eval.buffText;
		row.appendChild(meta);
	}
	host.appendChild(row);
	requestAnimationFrame(()=> requestAnimationFrame(()=> host.classList.add('pileIn')));
}

function renderPileStack(){
	// 你要求：取消「已出牌」區（pileStack），只顯示目前場上牌
	const host = $('pileStack');
	if(!host) return;
	host.innerHTML = '';
}

// ---------- 局部渲染（renderLite） ----------
// 之前曾嘗試插入 renderLite 但可能失敗，導致 renderLite 未定義而令「出牌/PASS/AI」之後直接炸。
// 呢度提供一個安全版本：優先局部更新，失敗就 fallback 全量 render（功能優先，保證可玩）。
function renderLite(changedPlayers){
	try{
		if(state.over){ try{ setScreen('victory'); }catch(e){} }
		// 版本 label
		const verLabel = $('verLabel');
		if(verLabel) verLabel.textContent = `版本 v${VERSION}`;
		// 玩家名 + 派系 + 手牌（只更新指定玩家；若冇傳入就當全更新）
		const list = Array.isArray(changedPlayers) && changedPlayers.length
			? [...new Set(changedPlayers.filter(x=>x!=null).map(x=>Number(x)))].filter(x=>Number.isFinite(x))
			: [...Array(state.players.length).keys()];
		const is2P = (state.players.length===2);
		for(const slot of list){
			if(slot>=state.players.length) continue;
			const pi = (!is2P) ? slot : (slot===0 ? state.turn : (slot===1 ? (1-state.turn) : slot));
			const p = state.players[pi];
			const nameEl = (slot===0)?$('p0Name'):(slot===1)?$('p1Name'):(slot===2)?$('p2Name'):$('p3Name');
			if(nameEl) nameEl.textContent = p?.name || '';
						if(p) setFactionLabel(slot===0?'p0Faction':slot===1?'p1Faction':slot===2?'p2Faction':'p3Faction', p.faction);
			renderHandSlot(slot);
		}
		$('rowP2')?.classList.toggle('hidden', state.players.length < 3);
		$('rowP3')?.classList.toggle('hidden', state.players.length < 4);
		renderCurrentPile();
		renderPileStack();
		setStatus();
		renderSelected();
		updateButtons();
	}catch(e){
		console.warn('[renderLite] fallback to render()', e);
		try{ render(); }catch(_e){}
	}
}
function render(){
	// 保險：若已結束就顯示勝利畫面
	if(state.over){
		try{ setScreen('victory'); }catch(e){}
	}
	const verLabel = $('verLabel');
	if(verLabel) verLabel.textContent = `版本 v${VERSION}`;
	const is2P = (state.players.length===2);
	for(let slot=0;slot<4;slot++){
		if(slot>=state.players.length) break;
		const pi = (!is2P) ? slot : (slot===0 ? state.turn : (slot===1 ? (1-state.turn) : slot));
		const p = state.players[pi];
		const nameEl = $(slot===0?'p0Name':slot===1?'p1Name':slot===2?'p2Name':'p3Name');
		if(nameEl) nameEl.textContent = p?.name || '';
		if(p) setFactionLabel(slot===0?'p0Faction':slot===1?'p1Faction':slot===2?'p2Faction':'p3Faction', p.faction);
		renderHandSlot(slot);
	}
	$('rowP2')?.classList.toggle('hidden', state.players.length < 3);
	$('rowP3')?.classList.toggle('hidden', state.players.length < 4);

	renderCurrentPile();
	renderPileStack();
	setStatus();
	renderSelected();
	updateButtons();
}

// ---------- 技能 helper ----------
function isActiveSkillBlockedByEmptyCity(targetPi){
	return state.skill.emptyCity?.has?.(targetPi);
}

function getHumanPi(){
	return 0;
}

function showSelectDialog({ title, hint, options }){
	return new Promise(resolve=>{
		const dlg = $('dlgSelect');
		const t = $('selTitle');
		const h = $('selHint');
		const list = $('selList');
		const btnCancel = $('btnSelCancel');
		if(!dlg || !t || !h || !list){ resolve(null); return; }
		t.textContent = title || '選擇';
		h.textContent = hint || '請選擇一個目標。';
		list.innerHTML = '';
		let done = false;
		const finish = (v)=>{
			if(done) return;
			done = true;
			try{ dlg.close(); }catch(e){}
			resolve(v);
		};
		(options||[]).forEach(opt=>{
			const b = document.createElement('button');
			b.type = 'button';
			b.className = 'selBtn';
			b.disabled = !!opt.disabled;
			b.innerHTML = `${opt.label}${opt.sub ? `<span class="sub">${opt.sub}</span>` : ''}`;
			b.addEventListener('click', ()=> finish(opt.value));
			list.appendChild(b);
		});
		const cancel = ()=> finish(null);
		btnCancel?.addEventListener('click', cancel, { once:true });
		dlg.addEventListener('cancel', cancel, { once:true });
		try{ dlg.showModal(); }catch(e){ resolve(null); }
	});
}
async function selectPlayer(promptTitle, candidates){
	if(!candidates.length) return null;
	return await showSelectDialog({
		title: promptTitle,
		hint: '請揀一個目標。',
		options: candidates.map(c=>({ value:c.pi, label:c.label }))
	});
}

async function selectCardIndexFromHand(pi, promptTitle){
	const p = state.players[pi];
	if(!p) return null;
	return await showSelectDialog({
		title: promptTitle,
		hint: '請揀 1 張牌。',
		options: p.hand.map((c,i)=>({ value:i, label: cardLabel(c) }))
	});
}

function describeFinal(mainRankBase, delta, reason){
	if(!delta) return `${rankFace(mainRankBase)}`;
	const sign = delta>0 ? '+' : '';
	return `${rankFace(mainRankBase)}→${rankFace(mainRankBase+delta)}（${sign}${delta} ${reason}）`;
}

// ---------- 評估（含萬能牌） ----------
function evaluatePlayWithSkills(cards, byPi){
	const p = state.players[byPi];
	if(!p) return { ok:false };

	// 飛將：權貴號令，萬能牌（只限 5 張組合：順子/葫蘆/同花順），只改點數
	const wc = state.skill.wildcard[byPi];
	if(wc && wc.idx!=null && cards.length===5){
		const chosenCard = p.hand[wc.idx];
		const usedInThisPlay = cards.some(c=> c.rank===chosenCard.rank && c.suit===chosenCard.suit);
		if(usedInThisPlay){
			let best = null;
			for(let r=2;r<=14;r++){
				const mapped = cards.map(c=>{
					if(c.rank===chosenCard.rank && c.suit===chosenCard.suit){
						return { ...c, rank:r, face: rankFace(r) };
					}
					return c;
				});
				const ev = evaluatePlayBase(mapped);
				if(!ev.ok) continue;
				if(!(ev.type===TYPE.STRAIGHT || ev.type===TYPE.FULLHOUSE || ev.type===TYPE.STRAIGHTFLUSH)) continue;
				if(!best) best = { ev };
				else{
					const a = ev;
					const b = best.ev;
					const better = (a.type>b.type) || (a.type===b.type && (a.mainRank>b.mainRank || (a.mainRank===b.mainRank && a.tieSuitRank>b.tieSuitRank)));
					if(better) best = { ev };
				}
			}
			if(best) return best.ev;
		}
	}

	return evaluatePlayBase(cards);
}

function computeMainRankDeltaForPlay(byPi, cards, evalObj){
	const p = state.players[byPi];
	if(!p) return { delta:0, reasons:[] };
	let delta = 0;
	const reasons = [];

	// 鋼骨：重甲壓境（被動）
	if(p.faction.key==='steel' && (evalObj.type===TYPE.SINGLE || evalObj.type===TYPE.PAIR || evalObj.type===TYPE.FULLHOUSE)){
		delta += 1;
		reasons.push('鋼骨-重甲壓境');
	}

	// 神機：獵殺本能（被動）
	if(p.faction.key==='archer'){
		const target = state.turnTargetForPredation ?? null;
		if(target!=null && state.players[target]?.hand?.length<=10){
			delta += 1;
			reasons.push('神機-獵殺本能');
		}
	}

	// 深淵：順勢而為（被動）
	if(p.faction.key==='abyss'){
		const st = state.skill.abyssFollowBuff[byPi];
		if(st?.active){
			if(st.stage==='next2'){
				delta += 2;
				reasons.push('深淵-順勢而為(+2)');
				st.stage='next1';
			} else {
				delta += 1;
				reasons.push('深淵-順勢而為(+1)');
			}
		}
	}

	// 雷鳴：蓄雷（被動）
	if(p.faction.key==='thunder'){
		const n = state.skill.charge[byPi] || 0;
		if(n>0){
			delta += n;
			reasons.push(`雷鳴-蓄雷(+${n})`);
			state.skill.charge[byPi] = 0;
		}
	}

	// 神機：機關陷阱（主動：對手本次出牌 -2）
	if(state.skill.trap && state.skill.trap.target===byPi){
		delta += state.skill.trap.reduce; // -2
		reasons.push('神機-機關陷阱');
		state.skill.trap = null;
	}

	// 鋼骨：鋼盾戰陣（主動：對手葫蘆 +3）
	if(state.pile && state.pile.by===byPi && state.pile.eval?.type===TYPE.FULLHOUSE && state.pile.buff?.steelWallBy!=null){
		delta += 3;
		reasons.push('鋼骨-鋼盾戰陣(+3)');
	}

	return { delta, reasons };
}

function getEvalForCompare(cards, byPi){
	const base = evaluatePlayWithSkills(cards, byPi);
	if(!base.ok) return base;
	const { delta } = computeMainRankDeltaForPlay(byPi, cards, base);
	return { ...base, mainRank: base.mainRank + (delta||0) };
}

// ---------- 出牌/回合 ----------
function getSelectedCards(pi){
	const p = state.players[pi];
	const idxs = [...p.selectedIdx].sort((a,b)=>a-b);
	return idxs.map(i=>p.hand[i]);
}

function removeCardsFromHand(pi, cardsToRemove){
	const p = state.players[pi];
	for(const c of cardsToRemove){
		const at = p.hand.findIndex(x=> x.rank===c.rank && x.suit===c.suit);
		if(at>=0) p.hand.splice(at,1);
	}
}

function nextTurn(){
	if(state.skill.trap && state.skill.trap.resumeTurn!=null && state.turn===state.skill.trap.by){
		state.turn = state.skill.trap.resumeTurn;
		state.skill.trap.resumeTurn = null;
	} else {
		state.turn = (state.turn + 1) % state.players.length;
	}
	for(const p of state.players){ p?.selectedIdx?.clear?.(); }
}

function passTurn(pi){
	const p = state.players[pi];
	if(state.skill.thunderForcePass?.target===pi){
		state.skill.thunderForcePass = null;
		log(`【雷霆震懼】${p.name} 被強制 PASS。`);
	}
	state.passCount += 1;
	playSfx('pass');
	log(`${p.name} PASS。`);

	// 雷鳴：蓄雷
	if(p.faction.key==='thunder'){
		state.skill.charge[pi] = clamp((state.skill.charge[pi]||0) + 1, 0, 3);
		log(`${p.name} 蓄雷 +1（累積 ${state.skill.charge[pi]}）`);
	}

	// 深淵：PASS 終止順勢
	if(p.faction.key==='abyss'){
		const st = state.skill.abyssFollowBuff[pi];
		if(st?.active){
			st.active = false;
			log(`${p.name} 順勢而為 終止（PASS）。`);
		}
	}

	if(state.passCount >= (state.players.length - 1) && state.pile){
		log(`所有人 PASS，${state.players[state.lead].name} 獲得控場權，場上清空。`);
		// 清場：只清目前場上牌
		state.pile = null;
		state.passCount = 0;
		state.turn = state.lead;
		// 深淵：獲得控場權即結束順勢
		if(state.players[state.lead]?.faction?.key==='abyss'){
			const st = state.skill.abyssFollowBuff[state.lead];
			if(st?.active){
				st.active = false;
				log(`【順勢而為】結束：${state.players[state.lead].name} 已獲得控場權。`);
			}
		}
		// 已出牌區已取消
		return { cleared:true };
	}
	return { cleared:false };
}

function playCards(pi, cards){
	const p = state.players[pi];

	const hadPileBeforePlay = !!state.pile;
	const pileByBeforePlay = state.pile ? state.pile.by : null;
	const leadBeforePlay = state.lead;

	const evBase = evaluatePlayWithSkills(cards, pi);
	if(!evBase.ok) return { ok:false, reason:'牌型不合法（只允許：單張/對子/順子/同花/葫蘆/同花順；飛將萬能牌只限 5 張組合）' };

	const evForCompare = getEvalForCompare(cards, pi);
	if(!compareEval(evForCompare, state.pile?.eval || null)) return { ok:false, reason:'壓唔過場上牌' };

	removeCardsFromHand(pi, cards);

	// 深淵：順勢而為（成功跟牌）
	if(p.faction.key==='abyss' && hadPileBeforePlay && leadBeforePlay!==pi){
		state.skill.abyssFollowBuff[pi] = { active:true, stage:'next2' };
		log(`【順勢而為】啟動：${p.name} 下一次出牌 +2，之後每次 +1，直到控場或 PASS。`);
	}

	// 神機：獵殺本能目標
	state.turnTargetForPredation = pileByBeforePlay;

	const { delta, reasons } = computeMainRankDeltaForPlay(pi, cards, evBase);
	const finalMain = evBase.mainRank + (delta||0);
	const finalText = reasons.length ? describeFinal(evBase.mainRank, delta, reasons.join('+')) : `${rankFace(evBase.mainRank)}`;

	state.pile = { cards:[...cards], eval:{...evBase, mainRank: finalMain, buffText: finalText}, by:pi };
	// 已出牌區已取消：唔再記錄 pileStack
	// state.pileStack.push({ cards:[...cards], by:pi, eval: evBase, ts:Date.now(), finalText });

	state.lead = pi;
	// 深淵：控場即結束順勢
	if(p.faction.key==='abyss'){
		const st = state.skill.abyssFollowBuff[pi];
		if(st?.active){
			st.active = false;
			log(`【順勢而為】結束：${p.name} 已獲得控場權。`);
		}
	}

	state.passCount = 0;
	playSfx('play');
	log(`${p.name} 出牌：${TYPE_NAME[evBase.type]} - ${cards.map(cardLabel).join(' ')} ｜ 主點數：${finalText}`);

	// 雷鳴：雷霆震懼
	if(p.faction.key==='thunder' && p.used.thunderFear && !state.skill.thunderForcePass){
		const target = (pi + 1) % state.players.length;
		state.skill.thunderForcePass = { target };
		log(`【雷霆震懼】生效：下一位 ${state.players[target].name} 必須 PASS。`);
	}

	if(p.hand.length===0){
		state.over = true;
		log(`勝利！${p.name} 先打完手牌。`, 'win');
		// 顯示勝利畫面
		try{
			const vn = $('victoryName');
			const vs = $('victorySub');
			if(vn) vn.textContent = `${p.name}｜凱旋而歸`;
			if(vs) vs.textContent = (p.isHuman ? '你贏了，軍帳響起戰鼓。' : '對手先打光手牌，你被迫撤退。');
			setScreen('victory');
		}catch(e){}
	}
	return { ok:true };
}

// ---------- AI ----------
function aiChoosePlay(pi){
	const p = state.players[pi];
	const hand = p.hand;
	sortHand(hand);

	const level = settings.aiLevel || 'expert';
	const candidates = [];

	// 基礎：只出單張/對子（唔識 5 張組合）
	for(const c of hand){ candidates.push([c]); }
	for(let i=0;i<hand.length;i++){
		for(let j=i+1;j<hand.length;j++){
			if(hand[i].rank===hand[j].rank) candidates.push([hand[i],hand[j]]);
		}
	}

	// 進階/高手：加入 5 張組合（順子/同花/葫蘆/同花順）
	if(level!=='basic' && hand.length>=5){
		for(let a=0;a<hand.length;a++){
			for(let b=a+1;b<hand.length;b++){
				for(let c=b+1;c<hand.length;c++){
					for(let d=c+1;d<hand.length;d++){
						for(let e=d+1;e<hand.length;e++){
							const pick = [hand[a],hand[b],hand[c],hand[d],hand[e]];
							const ev = evaluatePlayWithSkills(pick, pi);
							if(ev.ok) candidates.push(pick);
						}
					}
				}
			}
		}
	}

	const legal = [];
	for(const cards of candidates){
		const ev = getEvalForCompare(cards, pi);
		if(!ev.ok) continue;
		if(compareEval(ev, state.pile?.eval || null)) legal.push({ cards, ev });
	}
	if(legal.length===0) return { pass:true };

	// 基礎：揀最細可出（穩定）
	if(level==='basic'){
		legal.sort((x,y)=> (x.ev.type-y.ev.type) || (x.ev.mainRank-y.ev.mainRank));
		return { pass:false, cards: legal[0].cards };
	}

	// 進階：會出組合，但仍偏向慳牌（細牌優先）
	if(level==='advanced'){
		legal.sort((x,y)=> (x.ev.type-y.ev.type) || (x.ev.mainRank-y.ev.mainRank));
		return { pass:false, cards: legal[0].cards };
	}

	// 高手：優先 5 張組合，其次「剛好壓過」
	legal.sort((x,y)=>{
		const xIs5 = x.cards.length===5 ? 1 : 0;
		const yIs5 = y.cards.length===5 ? 1 : 0;
		if(xIs5!==yIs5) return (yIs5 - xIs5);
		if(x.ev.type!==y.ev.type) return (y.ev.type - x.ev.type);
		if(x.ev.mainRank!==y.ev.mainRank) return (x.ev.mainRank - y.ev.mainRank);
		return (x.ev.tieSuitRank - y.ev.tieSuitRank);
	});

	// 控場時：高手傾向先出細組合
	if(!state.pile){
		const five = legal.filter(x=>x.cards.length===5);
		if(five.length){
			five.sort((x,y)=> (x.ev.type-y.ev.type) || (x.ev.mainRank-y.ev.mainRank));
			return { pass:false, cards: five[0].cards };
		}
	}

	return { pass:false, cards: legal[0].cards };
}

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function runAITurn(pi){
	try{
		// AI 思考：輕微延遲（更似真人，但保持順滑）
		await sleep(aiThinkDelayMs());
		if(state.over) return;
		if(state.skill.thunderForcePass?.target===pi){
			passTurn(pi);
			nextTurn();
			renderLite([pi]);
			await sleep(60);
			pumpTurns();
			return;
		}
		const choice = aiChoosePlay(pi);
		if(choice.pass){
			const r = passTurn(pi);
			if(!r.cleared) nextTurn();
			renderLite([pi]);
			await sleep(60);
			pumpTurns();
			return;
		}
		const res = playCards(pi, choice.cards);
		if(!res.ok) passTurn(pi);
		if(!state.over) nextTurn();
		renderLite([pi]);
		await sleep(60);
		pumpTurns();
	}catch(e){
		console.error('[AI] runAITurn crashed', e);
		try{ passTurn(pi); }catch(_e){}
		try{ if(!state.over) nextTurn(); }catch(_e){}
		try{ render(); }catch(_e){}
		try{ setTimeout(()=>pumpTurns(), 0); }catch(_e){}
	}
}

function pumpTurns(){
	if(state.over) return;
	const cur = state.players[state.turn];
	if(cur?.isHuman) return;
	runAITurn(state.turn).catch?.(e=>console.error('runAITurn failed', e));
}

// ---------- 技能按鈕 ----------
function canUseSkill1(pi){
	const p = state.players[pi];
	if(!p) return false;
	switch(p.faction.key){
		case 'archer':
			if(p.used.archerTrap) return false;
			if(!state.pile) return false;
			return !isActiveSkillBlockedByEmptyCity(pi);
		case 'general':
			return !p.used.generalDecree;
		case 'strategist':
			if(p.used.strategistPlan) return false;
			return state.players.some(x=>x && x.hand.length<=10);
		case 'abyss':
			if(p.used.abyssSwallow) return false;
			return !!(state.pile && state.pile.eval?.type===TYPE.FULLHOUSE && state.pile.by!==pi);
		case 'thunder':
			return !p.used.thunderFear;
		default:
			return false;
	}
}

function canUseSkill2(pi){
	const p = state.players[pi];
	if(!p) return false;
	switch(p.faction.key){
		case 'steel':
			if(p.used.steelWall) return false;
			return !!(state.pile && state.pile.eval?.type===TYPE.FULLHOUSE && state.pile.by!==pi);
		case 'general':
			return !p.used.generalHouse;
		case 'strategist':
			if(p.used.strategistCity) return false;
			return p.hand.length<=10;
		default:
			return false;
	}
}

async function useSkill1Legacy(pi){
	const p = state.players[pi];
	if(!p) return;
	switch(p.faction.key){
		case 'archer': {
			if(!state.pile) return;
			if(isActiveSkillBlockedByEmptyCity(pi)) return;
			p.used.archerTrap = true;
			const target = state.pile.by;
			state.skill.trap = { by: pi, target, reduce: -2, resumeTurn: (target+1)%state.players.length };
			log(`${p.name} 發動【機關陷阱】：${state.players[target].name} 本次出牌主點數 -2，並跳到 ${p.name} 出牌。`);
			state.turn = pi;
			render();
			break;
		}
		case 'general': {
			const idx = await selectCardIndexFromHand(pi, '【權貴號令】選擇 1 張牌作萬能牌（只限 5 張組合）');
			if(idx===null) return;
			p.used.generalDecree = true;
			state.skill.wildcard[pi] = { idx };
			log(`${p.name} 發動【權貴號令】：${cardLabel(p.hand[idx])} 成為萬能牌（只限 5 張組合）。`);
			render();
			break;
		}
		case 'strategist': {
			const low = state.players.map((x,pi2)=>({x,pi2}))
				.filter(o=>o.x && o.x.hand.length<=10)
				.map(o=>({pi:o.pi2, label:`${o.x.name}（剩 ${o.x.hand.length}）`}));
			if(!low.length) return;
			const target = await selectPlayer('【計中計】選擇觸發玩家（剩 ≤10 張）', low);
			if(target==null) return;
			let maxPi = 0; let max = -1;
			for(let i=0;i<state.players.length;i++){
				const h = state.players[i]?.hand?.length ?? 0;
				if(h>max){ max=h; maxPi=i; }
			}
			const a = state.players[target];
			const b = state.players[maxPi];
			if(!a || !b) return;
			if(a.hand.length<2 || b.hand.length<2) return;
			p.used.strategistPlan = true;
			const aIdxs = shuffle([...Array(a.hand.length).keys()]).slice(0,2);
			const bIdxs = shuffle([...Array(b.hand.length).keys()]).slice(0,2);
			const aCards = aIdxs.map(i=>a.hand[i]);
			const bCards = bIdxs.map(i=>b.hand[i]);
			aIdxs.sort((x,y)=>y-x).forEach(i=>a.hand.splice(i,1));
			bIdxs.sort((x,y)=>y-x).forEach(i=>b.hand.splice(i,1));
			a.hand.push(...bCards);
			b.hand.push(...aCards);
			sortHand(a.hand); sortHand(b.hand);
			log(`${p.name} 發動【計中計】：${a.name} 與 ${b.name} 隨機交換 2 張牌。`);
			render();
			break;
		}
		case 'abyss': {
			const target = state.pile?.by;
			if(target==null) return;
			if(isActiveSkillBlockedByEmptyCity(pi)) return;
			p.used.abyssSwallow = true;
			log(`${p.name} 發動【潮汐吞噬】：${state.players[target].name} 的葫蘆出牌無效化，你立即獲得控場權。`);
			// 只清目前場上牌；桌面歷史疊牌保留
			state.pile = null;
			state.passCount = 0;
			state.lead = pi;
			state.turn = pi;
			render();
			break;
		}
		case 'thunder': {
			p.used.thunderFear = true;
			log(`${p.name} 蓄勢【雷霆震懼】：你下一次出牌後，下一位玩家必須 PASS。`);
			render();
			break;
		}
		default: break;
	}
}

async function useSkill2Legacy(pi){
	const p = state.players[pi];
	if(!p) return;
	switch(p.faction.key){
		case 'steel': {
			if(!state.pile || state.pile.eval?.type!==TYPE.FULLHOUSE || state.pile.by===pi) return;
			if(isActiveSkillBlockedByEmptyCity(state.pile.by)) return;
			p.used.steelWall = true;
			state.pile.buff = state.pile.buff || {};
			state.pile.buff.steelWallBy = pi;
			const baseMain = state.pile.eval.mainRank;
			state.pile.eval.mainRank = baseMain + 3;
			state.pile.eval.buffText = `${rankFace(baseMain)}→${rankFace(baseMain+3)}（+3 鋼骨-鋼盾戰陣）`;
			if(Array.isArray(state.pileStack) && state.pileStack.length){
				state.pileStack[state.pileStack.length-1].finalText = state.pile.eval.buffText;
			}
			log(`${p.name} 發動【鋼盾戰陣】：${state.players[state.pile.by].name} 的葫蘆主點數 +3（需用更大牌壓過或 PASS）。`);
			render();
			break;
		}
		case 'general': {
			const candidates = state.players.map((x,pi2)=>({x,pi2}))
				.filter(o=>o.x && o.pi2!==pi)
				.map(o=>({pi:o.pi2, label:`${o.x.name}（剩 ${o.x.hand.length}）`}));
			const target = await selectPlayer('【名門世家】選擇 1 名對手', candidates);
			if(target==null) return;
			const t = state.players[target];
			if(!t || t.hand.length===0) return;
			p.used.generalHouse = true;
			const drawn = pickRandom(t.hand);
			log(`${p.name} 發動【名門世家】：從 ${t.name} 抽出 1 張牌（${cardLabel(drawn)}）。`);
			if(drawn.rank>=11){
				const giveIdx = await selectCardIndexFromHand(pi, `抽到 ${cardLabel(drawn)}（≥J），選擇你要交換出去的 1 張牌`);
				if(giveIdx==null) return;
				const giveCard = p.hand[giveIdx];
				const at = t.hand.findIndex(c=>c.rank===drawn.rank && c.suit===drawn.suit);
				if(at>=0) t.hand.splice(at,1);
				p.hand.splice(giveIdx,1);
				p.hand.push(drawn);
				t.hand.push(giveCard);
				sortHand(p.hand); sortHand(t.hand);
				log(`交換完成：你得到 ${cardLabel(drawn)}，${t.name} 得到 ${cardLabel(giveCard)}。`);
			} else {
				log(`抽到 ${cardLabel(drawn)}（<J），放回去。`);
			}
			render();
			break;
		}
		case 'strategist': {
			p.used.strategistCity = true;
			state.skill.emptyCity.add(pi);
			log(`${p.name} 宣告【空城計】：其他玩家不能對你使用主動技能。`);
			render();
			break;
		}
		default: break;
	}
}

function updateButtons(){
	const btnPlay = $('btnPlay');
	const btnPass = $('btnPass');
	const btnS1 = $('btnSkill1');
	const btnS2 = $('btnSkill2');
	if(!btnPlay || !btnPass) return;

	if(state.screen!=='game'){
		btnPlay.disabled = true;
		btnPass.disabled = true;
		btnS1 && (btnS1.disabled = true);
		btnS2 && (btnS2.disabled = true);
		return;
	}

	const cur = state.players[state.turn];
	const isHumanTurn = !!cur?.isHuman && !state.over;
	const forcedPass = (state.skill.thunderForcePass?.target===state.turn);

	btnPass.disabled = !isHumanTurn;
	if(forcedPass){
		btnPlay.disabled = true;
	} else if(!isHumanTurn){
		btnPlay.disabled = true;
	} else {
		const selectedCards = getSelectedCards(state.turn);
		btnPlay.disabled = selectedCards.length===0;
	}

	const humanPi = getHumanPi();
	btnS1 && (btnS1.disabled = state.over ? true : !canUseSkill1(humanPi));
	btnS2 && (btnS2.disabled = state.over ? true : !canUseSkill2(humanPi));
}

// ---------- 開局抽派系（6 揀 1，AI 唔重覆） ----------
function draftFactionsFlow(availableFactions){
	return new Promise(resolve=>{
		const dlg = $('dlgDraft');
		const grid = $('draftGrid');
		const btnCancel = $('btnDraftCancel');
		if(!dlg || !grid){ resolve(availableFactions[0]); return; }
		grid.innerHTML = '';
		const picks = availableFactions.slice(0, 6);
		picks.forEach((f, idx)=>{
			const b = document.createElement('button');
			b.type = 'button';
			b.className = 'draftCard';
			const img = document.createElement('img');
			img.alt = '派系牌背面';
			tryLoadImage(img, cardBackCandidates(), ()=>{ img.remove(); });
			const cap = document.createElement('div');
			cap.className = 'cap';
			cap.textContent = `派系牌 ${idx+1}`;
			b.appendChild(img);
			b.appendChild(cap);
			b.addEventListener('click', ()=>{ try{ dlg.close(); }catch(e){} resolve(f); });
			grid.appendChild(b);
		});
		const cancel = ()=>{ try{ dlg.close(); }catch(e){} resolve(picks[0]); };
		btnCancel?.addEventListener('click', cancel);
		dlg.showModal();
	});
}

function readyFlow2P(){
	return new Promise(resolve=>{
		let who = 0;
		const dlg = $('dlgReady');
		const txt = $('readyText');
		const btn = $('btnReadyOk');
		if(!dlg || !txt || !btn){ resolve(); return; }
		const show = ()=>{
			txt.textContent = `${state.players[who].name}：請按「我準備好」開始接牌。`;
			if(!dlg.open) dlg.showModal();
		};
		const handler = ()=>{
			who += 1;
			if(who>=2){ btn.removeEventListener('click', handler); dlg.close(); resolve(); return; }
			show();
		};
		btn.addEventListener('click', handler);
		show();
	});
}

function findDiamond2Owner(){
	for(let i=0;i<state.players.length;i++){
		if(state.players[i].hand.some(c=>c.suit==='D' && c.rank===2)) return i;
	}
	return -1;
}

async function startNewGame(config){
	state.over = false;
	state.lastStartConfig = clone(config);
	state.mode = config.mode;
	state.config = config;
	state.chapterIndex = 0;
	state.turnTargetForPredation = null;
	state.skill.trap = null;
	state.initialHandSize = (config.players===2) ? 20 : 13;
	state.skill.emptyCity = new Set();
	state.skill.thunderForcePass = null;
	state.skill.charge = {};
	state.skill.abyssFollowBuff = {};
	state.skill.wildcard = {};

	if(config.players===2){
		state.players = [ newPlayer('你（Johnny）', true), newPlayer('玩家 2', true) ];
	} else {
		state.players = [ newPlayer('你（Johnny）', true), newPlayer('Carlos', false), newPlayer('Cherry', false), newPlayer('Christy', false) ];
	}

	// 抽派系（不重覆）
	{
		const bag = shuffle(clone(FACTIONS));
		const chosen = await draftFactionsFlow(bag);
		const rest = bag.filter(f=> f.key !== chosen.key);
		state.players[0].faction = clone(chosen);
		for(let i=1;i<state.players.length;i++) state.players[i].faction = clone(rest[i-1]);
	}

	state.turn = 0;
	state.lead = 0;
	state.pile = null;
	state.pileStack = [];
	state.passCount = 0;

	const logEl = $('log');
	if(logEl) logEl.innerHTML = '';
	log(config.mode==='story' ? '故事模式：新局開始（4 人）。' : (config.players===2 ? '二人對戰：新局開始。' : '四人對戰：新局開始。'));

	if(config.players===2) await readyFlow2P();

	const deck = buildDeck();
	const handSize = (config.players===2) ? 20 : 13;
	for(let i=0;i<handSize;i++){
		for(const p of state.players){ p.hand.push(deck.pop()); }
	}
	for(const p of state.players){ sortHand(p.hand); }

	const starter = findDiamond2Owner();
	if(starter !== -1){
		state.turn = starter;
		state.lead = starter;
		log(`先手判定：${state.players[starter].name} 持有 ♦2，先出。`);
	}

		setScreen('game');
	render();
	pumpTurns();
}

function showStoryDialog(){
	const ch = currentChapter();
	if(!ch){
		const storyEl = $('storyText');
		if(storyEl) storyEl.textContent = '你而家係自由對戰（無章節）。\n如果想睇章節故事，請用「故事模式」。';
		const dlg = $('dlgStory');
		if(dlg) dlg.showModal();
		return;
	}
	const storyEl2 = $('storyText');
	if(storyEl2) storyEl2.textContent = `${ch.title}\n\n${ch.story}`;
	const dlg = $('dlgStory');
	if(dlg) dlg.showModal();
}

// ---------- UI 綁定 ----------
$('btnHelp')?.addEventListener('click', ()=> $('dlgHelp')?.showModal());
$('btnTitleHelp')?.addEventListener('click', ()=> $('dlgHelp')?.showModal());
$('btnCloseHelp')?.addEventListener('click', ()=> $('dlgHelp')?.close());

$('btnStory')?.addEventListener('click', ()=> showStoryDialog());
$('btnCloseStory')?.addEventListener('click', ()=> $('dlgStory')?.close());

$('btnSettings')?.addEventListener('click', ()=> $('dlgSettings')?.showModal());
$('btnTitleSettings')?.addEventListener('click', ()=> $('dlgSettings')?.showModal());
$('btnCloseSettings')?.addEventListener('click', ()=> $('dlgSettings')?.close());

// 主頁 AI 難度（基礎／進階／高手）
$('setAiLevel')?.addEventListener('change', (e)=>{
	settings.aiLevel = e.target.value;
	playSfx('ui');
});

$('setSfx')?.addEventListener('change', (e)=>{ settings.sfx = !!e.target.checked; playSfx('ui'); });
$('setMusic')?.addEventListener('change', (e)=>{ settings.music = !!e.target.checked; refreshMusic(); playSfx('ui'); });
$('setSpeed')?.addEventListener('change', (e)=>{ settings.speed = e.target.value; playSfx('ui'); });

$('btnNew')?.addEventListener('click', ()=> startNewGame({ mode:'story', players:4 }));
function backToHome(){
	state.over = false;
	setScreen('title');
}
function restartLastGame(){
	const cfg = state.lastStartConfig || { mode:'free', players:4 };
	startNewGame(cfg);
}
$('btnHome')?.addEventListener('click', ()=> backToHome());
$('btnRestart')?.addEventListener('click', ()=> restartLastGame());
// 勝利畫面按鈕
$('btnVictoryRestart')?.addEventListener('click', ()=>{
	// 以最後一局設定再開
	const cfg = state.lastStartConfig || { mode:'free', players:4 };
	startNewGame(cfg);
});
$('btnVictoryHome')?.addEventListener('click', ()=> backToHome());
$('cardStory')?.addEventListener('click', ()=> startNewGame({ mode:'story', players:4 }));
$('card2p')?.addEventListener('click', ()=> startNewGame({ mode:'free', players:2 }));
$('card4p')?.addEventListener('click', ()=> startNewGame({ mode:'free', players:4 }));

function suggestPlayForHuman(){
	const pi = getHumanPi();
	const p = state.players[pi];
	if(!p || state.over) return null;
	const prev = state.pile?.eval || null;
	const hand = [...p.hand];
	sortHand(hand);
	const candidates = [];
	for(const c of hand) candidates.push([c]);
	for(let i=0;i<hand.length;i++){
		for(let j=i+1;j<hand.length;j++) if(hand[i].rank===hand[j].rank) candidates.push([hand[i],hand[j]]);
	}
	if(hand.length>=5){
		for(let a=0;a<hand.length;a++){
			for(let b=a+1;b<hand.length;b++){
				for(let c=b+1;c<hand.length;c++){
					for(let d=c+1;d<hand.length;d++){
						for(let e=d+1;e<hand.length;e++){
							const pick = [hand[a],hand[b],hand[c],hand[d],hand[e]];
							const ev = getEvalForCompare(pick, pi);
							if(ev.ok && compareEval(ev, prev)) candidates.push(pick);
						}
					}
				}
			}
		}
	}
	const legal = candidates.map(cards=>({ cards, ev: getEvalForCompare(cards, pi) }))
		.filter(x=>x.ev.ok && compareEval(x.ev, prev));
	if(!legal.length) return { pass:true };
	// 盡量「剛好壓過」：先按 type 再按 mainRank
	legal.sort((x,y)=> (x.ev.type-y.ev.type) || (x.ev.mainRank-y.ev.mainRank) || (x.ev.tieSuitRank-y.ev.tieSuitRank));
	return { pass:false, cards: legal[0].cards };
}
function selectCardsInHand(pi, cards){
	const p = state.players[pi];
	if(!p) return;
	p.selectedIdx.clear();
	cards.forEach(c=>{
		const idx = p.hand.findIndex(x=>x.rank===c.rank && x.suit===c.suit);
		if(idx>=0) p.selectedIdx.add(idx);
	});
}
// 提示功能：已按你要求取消（保留函式但停用 handler，避免之後又影響選牌/出牌狀態）
// $('btnHint')?.addEventListener('click', ()=>{});
if($('btnHint')){
	try{ $('btnHint').disabled = true; }catch(e){}
}
$('btnPlay')?.addEventListener('click', ()=>{
	if(state.over) return;
	const actedPi = state.turn;
	const cur = state.players[actedPi];
	if(!cur?.isHuman){
		log('未到你回合，無法出牌。', 'err');
		return;
	}
	if(state.skill.thunderForcePass?.target===actedPi){
		log('你被【雷霆震懼】指定，本回合必須 PASS。', 'err');
		return;
	}
	const cards = getSelectedCards(actedPi);
	if(cards.length===0){
		try{ log(`你尚未選牌。（turn=${actedPi} selected=${state.players[actedPi]?.selectedIdx?.size||0}）`, 'err'); }catch(e){ log('你尚未選牌。', 'err'); }
		return;
	}
	const res = playCards(actedPi, cards);
	if(!res.ok){ log(`無法出牌：${res.reason}`, 'err'); return; }
	cur.selectedIdx.clear();
	if(!state.over) nextTurn();
	// 出牌後：同時更新「出牌者」+「下一手」+「控場者」視覺，避免 UI 亂／以為出唔到牌
	renderLite([actedPi, state.turn, state.lead]);
	pumpTurns();
});

$('btnPass')?.addEventListener('click', ()=>{
	if(state.over) return;
	const actedPi = state.turn;
	const cur = state.players[actedPi];
	if(!cur?.isHuman){
		log('未到你回合，無法 PASS。', 'err');
		return;
	}
	cur.selectedIdx.clear();
	const r = passTurn(actedPi);
	if(!r.cleared) nextTurn();
	renderLite([actedPi, state.turn, state.lead]);
	pumpTurns();
});

$('btnSkill1')?.addEventListener('click', ()=> useSkill1Legacy(getHumanPi()));
$('btnSkill2')?.addEventListener('click', ()=> useSkill2Legacy(getHumanPi()));

// ---------- 技能按鈕文字（顯示技能名 + 效果） ----------
function getSkillInfo(pi){
	const p = state.players[pi];
	if(!p) return { s1:{title:'技能 1', desc:'—'}, s2:{title:'技能 2', desc:'—'} };
	switch(p.faction.key){
		case 'steel':
			return {
				s1:{ title:'重甲壓境', desc:'單張/對子/葫蘆：點數 +1（被動）' },
				s2:{ title:'鋼盾戰陣', desc:'對手出葫蘆時：點數 +3（每局 1 次）' },
			};
		case 'archer':
			return {
				s1:{ title:'機關陷阱', desc:'對手本次出牌 -2，直接跳到你（每局 1 次）' },
				s2:{ title:'獵殺本能', desc:'對手 ≤10 張：你對該玩家出牌 +1（被動）' },
			};
		case 'general':
			return {
				s1:{ title:'權貴號令', desc:'選 1 張牌作萬能牌（只限 5 張組合，每局 1 次）' },
				s2:{ title:'名門世家', desc:'抽對手 1 張牌，≥J 可用你任意牌交換（每局 1 次）' },
			};
		case 'strategist':
			return {
				s1:{ title:'計中計', desc:'任意玩家 ≤10 張：強制其與手牌最多者交換 2 張（每局 1 次）' },
				s2:{ title:'空城計', desc:'你 ≤10 張：免疫其他玩家主動技（持續到完局）' },
			};
		case 'abyss':
			return {
				s1:{ title:'潮汐吞噬', desc:'對手出葫蘆：該手無效，你即刻控場（每局 1 次）' },
				s2:{ title:'順勢而為', desc:'跟牌後：下次 +2，其後每次 +1（到控場或 PASS）' },
			};
		case 'thunder':
			return {
				s1:{ title:'雷霆震懼', desc:'你下一次出牌後，下一位必須 PASS（每局 1 次）' },
				s2:{ title:'蓄雷', desc:'每 PASS +1（最多 +3），下次出牌加點後清空（被動）' },
			};
		default:
			return { s1:{title:'技能 1', desc:'—'}, s2:{title:'技能 2', desc:'—'} };
	}
}
function setSkillButtons(){
	const btnS1 = $('btnSkill1');
	const btnS2 = $('btnSkill2');
	if(!btnS1 || !btnS2) return;
	const pi = getHumanPi();
	const info = getSkillInfo(pi);
	btnS1.innerHTML = `<span class="skillBtnTitle">${info.s1.title}</span><span class="skillBtnDesc">${info.s1.desc}</span>`;
	btnS2.innerHTML = `<span class="skillBtnTitle">${info.s2.title}</span><span class="skillBtnDesc">${info.s2.desc}</span>`;
}
// 重新宣告 updateButtons（放喺後面覆蓋舊版本）
function updateButtons(){
	const btnPlay = $('btnPlay');
	const btnPass = $('btnPass');
	const btnCancelSel = $('btnCancelSel');
	const btnS1 = $('btnSkill1');
	const btnS2 = $('btnSkill2');
	if(!btnPlay || !btnPass) return;
	setSkillButtons();
	if(state.screen!=='game'){
		btnPlay.disabled = true;
		btnPass.disabled = true;
		btnCancelSel && (btnCancelSel.disabled = true);
		btnS1 && (btnS1.disabled = true);
		btnS2 && (btnS2.disabled = true);
		return;
	}
	const cur = state.players[state.turn];
	const isHumanTurn = !!cur?.isHuman && !state.over;
	const forcedPass = (state.skill.thunderForcePass?.target===state.turn);
	btnPass.disabled = !isHumanTurn;
	btnCancelSel && (btnCancelSel.disabled = !isHumanTurn);
	// 提示已停用
	const btnHint = $('btnHint');
	btnHint && (btnHint.disabled = true);
	if(forcedPass || !isHumanTurn){
		btnPlay.disabled = true;
	} else {
		const selectedCards = getSelectedCards(state.turn);
		btnPlay.disabled = selectedCards.length===0;
	}
	const humanPi = getHumanPi();
	btnS1 && (btnS1.disabled = state.over ? true : !canUseSkill1(humanPi));
	btnS2 && (btnS2.disabled = state.over ? true : !canUseSkill2(humanPi));
}
const dlgLog = $('dlgLog');
$('btnLog')?.addEventListener('click', ()=>{
	// 桌面版：改為「收合/展開」右側戰報浮窗
	if(window.matchMedia && window.matchMedia('(min-width: 980px)').matches){
		const panel = $('rightLog');
		if(panel){
			panel.style.display = (panel.style.display==='none') ? '' : 'none';
		}
		return;
	}
	// 手機版：開彈窗
	try{ dlgLog?.showModal(); }catch(e){}
});
// 取消選牌
$('btnCancelSel')?.addEventListener('click', ()=>{
	if(state.over) return;
	const cur = state.players[state.turn];
	if(!cur?.isHuman) return;
	cur.selectedIdx.clear();
	// 取消選牌後：手牌要即刻縮回去（包括提示自動選牌）
	// 2P 熱座位：底部手牌槽位固定係 slot 0
	if(state.players.length===2) renderHandSlot(0);
	else renderHandSlot(state.turn);
	renderSelected();
	updateButtons();
	playSfx('ui');
});
$('btnCloseLog')?.addEventListener('click', ()=>{ try{ dlgLog?.close(); }catch(e){} });

function boot(){
	const sub = $('subTitle');
	if(sub) sub.textContent = '單機 Web 版（模式：故事/2P/4P）';
	setScreen('title');
	// 同步主頁難度下拉
	const sel = $('setAiLevel');
	if(sel) sel.value = settings.aiLevel || 'expert';
	// 等用戶第一次操作先解鎖音效/音樂（避免 Console 出現 AudioContext 警告）
	window.addEventListener('pointerdown', unlockAudioOnce, true);
	window.addEventListener('keydown', unlockAudioOnce, true);
	render();
}

boot();
