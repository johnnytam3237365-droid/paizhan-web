// 派戰 PaiZhan - 單機 Web 版
// 模式：故事模式（4P 你vs3AI）、二人對戰（2P 兩個人）、四人對戰（4P 你vs3AI）

const VERSION = '0.3.0';

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

// ---------- 設定 ----------
const settings = {
	sfx: true,
	speed: 'normal', // fast | normal | slow
};

function speedMs(){
	if(settings.speed==='fast') return 220;
	if(settings.speed==='slow') return 700;
	return 450;
}

function playSfx(kind){
	if(!settings.sfx) return;
	try{
		const ctx = new (window.AudioContext || window.webkitAudioContext)();
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		o.connect(g); g.connect(ctx.destination);
		o.type = 'sine';
		const f = kind==='play' ? 660 : kind==='pass' ? 220 : 440;
		o.frequency.value = f;
		g.gain.value = 0.05;
		o.start();
		setTimeout(()=>{ o.stop(); ctx.close(); }, 80);
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
const CARD_IMG_VARIANT = '2';
const IMG_EXTS = ['.png', '.PNG', '.jpg', '.JPG'];

function tryLoadImage(imgEl, srcList, onAllFail){
	let i = 0;
	const tryNext = ()=>{
		if(i >= srcList.length){
			imgEl.onerror = null;
			if(onAllFail) onAllFail();
			return;
		}
		imgEl.src = srcList[i++];
	};
	imgEl.onerror = tryNext;
	tryNext();
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
	const variant = useVariant ? CARD_IMG_VARIANT : '';
	const base = `${CARD_IMG_DIR}/${r}_of_${s}${variant}`;
	return IMG_EXTS.map(ext=> base + ext);
}
function cardBackCandidates(){
	const base = `${CARD_IMG_DIR}/back`;
	return IMG_EXTS.map(ext=> base + ext);
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

function evaluatePlay(cards){
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
	// 你設定：
	// 1) 單張/對子：必須同牌型先可壓
	// 2) 順子或以上：可以壓更大牌型（或同牌型比點數/花色）
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

// ---------- 派系（版本 A：每派 2 招；入口保留） ----------
const FACTIONS = [
	{ key: 'steel', name: '🛡️ 鋼骨', skill1: { name: '重甲壓境', once: false }, skill2: { name: '鋼盾戰陣', once: true } },
	{ key: 'archer', name: '🏹 神機', skill1: { name: '機關陷阱', once: true }, skill2: { name: '獵殺本能', once: false } },
	{ key: 'general', name: '⚔️ 飛將', skill1: { name: '權貴號令', once: true }, skill2: { name: '名門世家', once: true } },
	{ key: 'strategist', name: '📜 智囊', skill1: { name: '計中計', once: true }, skill2: { name: '空城計', once: true } },
	{ key: 'abyss', name: '🌊 深淵', skill1: { name: '潮汐吞噬', once: true }, skill2: { name: '順勢而為', once: true } },
	{ key: 'thunder', name: '⚡ 雷鳴', skill1: { name: '雷霆震懼', once: true }, skill2: { name: '蓄雷', once: false } },
];

// ---------- 故事模式（六章；暫時不改規則） ----------
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
	passCount: 0,
	over: false,
	config: { players: 4 },
	lastStartConfig: null,
};

function newPlayer(name, isHuman){
	const faction = clone(FACTIONS[Math.floor(Math.random()*FACTIONS.length)]);
	return {
		name,
		isHuman,
		faction,
		hand: [],
		selectedIdx: new Set(),
		used: { skill1:false, skill2:false },
		buff: {},
	};
}

function log(msg, kind=''){
	const el = $('log');
	const div = document.createElement('div');
	div.className = 'item ' + kind;
	div.textContent = msg;
	el.prepend(div);
}

function setScreen(name){
	state.screen = name;
	$('screenTitle').classList.toggle('hidden', name!=='title');
	$('screenGame').classList.toggle('hidden', name!=='game');
}

function currentChapter(){
	if(state.mode!=='story') return null;
	return CHAPTERS[clamp(state.chapterIndex, 0, CHAPTERS.length-1)];
}

function setStatus(){
	const p = state.players[state.turn];
	const pileText = state.pile ? `${TYPE_NAME[state.pile.eval.type]}（主點數 ${rankFace(state.pile.eval.mainRank)}）` : '無';
	$('status').textContent = [`回合：${p.name}`, `場上：${pileText}`, `PASS 連續次數：${state.passCount}`].join('\n');
	const ch = currentChapter();
	$('chapter').textContent = ch ? `${ch.title}\n（故事模式）` : '自由對戰（無章節）';
	// mobile summary line
	const mini = $('statusMini');
	if(mini){
		mini.textContent = `回合：${p.name} ｜ 場上：${pileText}`;
	}
}

function cardDiv(c, small=false, showFront=true){
	const d = document.createElement('div');
	d.className = 'card ' + (small ? 'small' : '');
	const img = document.createElement('img');
	img.className = 'cardImg';
	img.alt = showFront ? cardLabel(c) : '背面';
	if(showFront){
		const list = [...cardImgCandidates(c, true), ...cardImgCandidates(c, false)];
		tryLoadImage(img, list, ()=>{
			img.remove();
			d.textContent = cardLabel(c);
		});
	} else {
		tryLoadImage(img, cardBackCandidates(), ()=>{
			img.remove();
			d.textContent = '牌';
			d.style.color = 'rgba(255,255,255,.6)';
		});
	}
	d.appendChild(img);
	return d;
}

function setFactionLabel(elId, faction){
	const el = $(elId);
	el.innerHTML = '';
	const img = document.createElement('img');
	img.className = 'factionImg';
	img.alt = faction.key;
	const base = `assets/factions/${faction.key}`;
	tryLoadImage(img, IMG_EXTS.map(ext=> base + ext), ()=>{ img.remove(); });
	const t = document.createElement('span');
	t.textContent = faction.name;
	el.appendChild(img);
	el.appendChild(t);
}

function renderHand(pi){
	const p = state.players[pi];
	const el = $(pi===0?'p0Hand':pi===1?'p1Hand':pi===2?'p2Hand':'p3Hand');
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

	// 2P：只顯示「當前出牌方」手牌正面；另一邊顯示背面（輪到對方就互換）
	const is2P = (state.players.length===2);
	const showFront = !is2P || (state.turn===pi);
	p.hand.forEach((c, idx)=>{
		const d = cardDiv(c, false, showFront);
		d.dataset.idx = String(idx);
		if(showFront && p.selectedIdx.has(idx)) d.classList.add('selected');
		d.addEventListener('click', ()=>{
			if(state.over) return;
			// 只允許點自己嘅手牌（人類玩家）
			if(!p.isHuman) return;
			// 允許提前揀牌（就算未輪到你 / 甚至 AI 回合）
			// 真正出牌仍然只會喺 btnPlay click / updateButtons() 判斷。

			if(p.selectedIdx.has(idx)) p.selectedIdx.delete(idx);
			else p.selectedIdx.add(idx);

			// 只更新該張牌嘅 class，避免整排重繪造成閃爍
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

function render(){
	$('verLabel').textContent = `版本 v${VERSION}`;

	// 名稱 + 派系 + 手牌
	for(let i=0;i<4;i++){
		const p = state.players[i];
		$(i===0?'p0Name':i===1?'p1Name':i===2?'p2Name':'p3Name').textContent = p?.name || '';
		if(p) setFactionLabel(i===0?'p0Faction':i===1?'p1Faction':i===2?'p2Faction':'p3Faction', p.faction);
		else $(i===0?'p0Faction':i===1?'p1Faction':i===2?'p2Faction':'p3Faction').textContent='';
		if(p) renderHand(i);
	}

	// 2P 隱藏 p2/p3
	$('rowP2').classList.toggle('hidden', state.players.length < 3);
	$('rowP3').classList.toggle('hidden', state.players.length < 4);

	// 場上牌
	const pileEl = $('pile');
	pileEl.innerHTML = '';
	if(state.pile){
		for(const c of state.pile.cards){ pileEl.appendChild(cardDiv(c, true, true)); }
		const info = document.createElement('div');
		info.style.marginTop = '8px';
		info.style.color = '#aab3dd';
		info.style.fontSize = '12px';
		info.textContent = `${state.players[state.pile.by].name} 出了：${TYPE_NAME[state.pile.eval.type]}`;
		pileEl.appendChild(info);
	} else {
		pileEl.textContent = '尚未有人出牌。控場者可任意開局。';
	}

	$('lead').textContent = state.players[state.lead]?.name || '';
	setStatus();
	renderSelected();
	updateButtons();
}

// ---------- 合法出牌判定（用於 disabled） ----------
function hasAnyLegalPlayForPlayer(pi){
	const p = state.players[pi];
	const hand = p.hand;
	const pileEval = state.pile?.eval || null;
	if(!pileEval) return hand.length>0;

	for(const c of hand){
		const ev = evaluatePlay([c]);
		if(ev.ok && compareEval(ev, pileEval)) return true;
	}
	for(let i=0;i<hand.length;i++){
		for(let j=i+1;j<hand.length;j++){
			if(hand[i].rank!==hand[j].rank) continue;
			const ev = evaluatePlay([hand[i], hand[j]]);
			if(ev.ok && compareEval(ev, pileEval)) return true;
		}
	}
	if(hand.length>=5){
		for(let a=0;a<hand.length;a++){
			for(let b=a+1;b<hand.length;b++){
				for(let c=b+1;c<hand.length;c++){
					for(let d=c+1;d<hand.length;d++){
						for(let e=d+1;e<hand.length;e++){
							const pick = [hand[a],hand[b],hand[c],hand[d],hand[e]];
							const ev = evaluatePlay(pick);
							if(ev.ok && compareEval(ev, pileEval)) return true;
						}
					}
				}
			}
		}
	}
	return false;
}

function getSelectedCards(pi){
	const p = state.players[pi];
	const idxs = [...p.selectedIdx].sort((a,b)=>a-b);
	return idxs.map(i=>p.hand[i]);
}

function isSelectionPlayable(pi){
	const selectedCards = getSelectedCards(pi);
	if(selectedCards.length===0) return false;
	const ev = evaluatePlay(selectedCards);
	if(!ev.ok) return false;
	return compareEval(ev, state.pile?.eval || null);
}

function updateButtons(){
	const btnPlay = $('btnPlay');
	const btnPass = $('btnPass');

	if(state.screen!=='game'){
		btnPlay.disabled = true;
		btnPass.disabled = true;
		$('btnSkill1').disabled = true;
		$('btnSkill2').disabled = true;
		return;
	}

	const cur = state.players[state.turn];
	const isHumanTurn = !!cur?.isHuman && !state.over;
	btnPass.disabled = !isHumanTurn;
	$('btnSkill1').disabled = true;
	$('btnSkill2').disabled = true;

	if(!isHumanTurn){
		btnPlay.disabled = true;
		return;
	}

	// 無任何可壓牌（只有場上有牌先會出現）
	if(state.pile && !hasAnyLegalPlayForPlayer(state.turn)){
		btnPlay.disabled = true;
		return;
	}

	// 已選牌但不可出 → disabled
	const selectedCards = getSelectedCards(state.turn);
	if(selectedCards.length>0 && !isSelectionPlayable(state.turn)){
		btnPlay.disabled = true;
		return;
	}

	btnPlay.disabled = selectedCards.length===0;
}

// ---------- ♦2 先手 ----------
function findDiamond2Owner(){
	for(let i=0;i<state.players.length;i++){
		if(state.players[i].hand.some(c=>c.suit==='D' && c.rank===2)) return i;
	}
	return -1;
}

// ---------- 回合 ----------
function nextTurn(){
	state.turn = (state.turn + 1) % state.players.length;
	// 熱座位：每次換手就清走所有玩家已選，避免交機時露底
	for(const p of state.players){
		if(p?.selectedIdx) p.selectedIdx.clear();
	}
}

function passTurn(pi){
	const p = state.players[pi];
	state.passCount += 1;
	playSfx('pass');
	log(`${p.name} PASS。`);

	if(state.passCount >= (state.players.length - 1) && state.pile){
		log(`所有人 PASS，${state.players[state.lead].name} 獲得控場權，場上清空。`);
			state.pile = null;
	state.pileStack = [];
	state.passCount = 0;
	state.turn = state.lead;
	renderPileStack();
	return { cleared:true };
	}
	return { cleared:false };
}

function removeCardsFromHand(pi, cardsToRemove){
	const p = state.players[pi];
	for(const c of cardsToRemove){
		const at = p.hand.findIndex(x=> x.rank===c.rank && x.suit===c.suit);
		if(at>=0) p.hand.splice(at,1);
	}
}

function playCards(pi, cards){
	const p = state.players[pi];
	const evalObj = evaluatePlay(cards);
	if(!evalObj.ok) return { ok:false, reason:'牌型不合法（只允許：單張/對子/順子/同花/葫蘆/同花順）' };
	if(!compareEval(evalObj, state.pile?.eval || null)) return { ok:false, reason:'壓唔過場上牌' };

	removeCardsFromHand(pi, cards);
	state.pile = { cards: [...cards], eval: evalObj, by: pi };
	state.lead = pi;
	state.passCount = 0;
	playSfx('play');
	log(`${p.name} 出牌：${TYPE_NAME[evalObj.type]} - ${cards.map(cardLabel).join(' ')}`);

	if(p.hand.length===0){
		state.over = true;
		log(`勝利！${p.name} 先打完手牌。`, 'win');
	}
	return { ok:true };
}

function aiChoosePlay(pi){
	const p = state.players[pi];
	const hand = p.hand;
	sortHand(hand);
	const candidates = [];

	for(const c of hand){ candidates.push([c]); }
	for(let i=0;i<hand.length;i++){
		for(let j=i+1;j<hand.length;j++){
			if(hand[i].rank===hand[j].rank) candidates.push([hand[i],hand[j]]);
		}
	}
	if(hand.length>=5){
		for(let a=0;a<hand.length;a++){
			for(let b=a+1;b<hand.length;b++){
				for(let c=b+1;c<hand.length;c++){
					for(let d=c+1;d<hand.length;d++){
						for(let e=d+1;e<hand.length;e++){
							const pick = [hand[a],hand[b],hand[c],hand[d],hand[e]];
							const ev = evaluatePlay(pick);
							if(ev.ok) candidates.push(pick);
						}
					}
				}
			}
		}
	}

	const legal = [];
	for(const cards of candidates){
		const ev = evaluatePlay(cards);
		if(!ev.ok) continue;
		if(compareEval(ev, state.pile?.eval || null)) legal.push({ cards, ev });
	}
	if(legal.length===0) return { pass:true };
	legal.sort((x,y)=> (x.ev.type-y.ev.type) || (x.ev.mainRank-y.ev.mainRank));
	return { pass:false, cards: legal[0].cards };
}

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function runAITurn(pi){
	await sleep(speedMs());
	if(state.over) return;
	const choice = aiChoosePlay(pi);
	if(choice.pass){
		const r = passTurn(pi);
		if(!r.cleared) nextTurn();
		render();
		await sleep(120);
		pumpTurns();
		return;
	}

	const res = playCards(pi, choice.cards);
	if(!res.ok) passTurn(pi);
	if(!state.over) nextTurn();
	render();
	await sleep(120);
	pumpTurns();
}

function pumpTurns(){
	if(state.over) return;
	const cur = state.players[state.turn];
	if(cur?.isHuman) return;
	runAITurn(state.turn);
}

// ---------- 2P 準備流程 ----------
function readyFlow2P(){
	return new Promise(resolve=>{
		let who = 0;
		const dlg = $('dlgReady');
		const txt = $('readyText');
		const btn = $('btnReadyOk');

		const show = ()=>{
			txt.textContent = `${state.players[who].name}：請按「我準備好」開始接牌。`;
			if(!dlg.open) dlg.showModal();
		};

		const handler = ()=>{
			who += 1;
			if(who>=2){
				btn.removeEventListener('click', handler);
				dlg.close();
				resolve();
				return;
			}
			show();
		};

		btn.addEventListener('click', handler);
		show();
	});
}

// ---------- 開局 ----------
async function startNewGame(config){
	// config: { mode:'story'|'free', players:2|4 }
	state.lastStartConfig = clone(config);
	state.mode = config.mode;
	state.config = config;
	state.chapterIndex = 0;

	if(config.players===2){
		state.players = [
			newPlayer('你（Johnny）', true),
			newPlayer('玩家 2', true),
		];
	} else {
		state.players = [
			newPlayer('你（Johnny）', true),
			newPlayer('AI-1', false),
			newPlayer('AI-2', false),
			newPlayer('AI-3', false),
		];
	}

	state.turn = 0;
	state.lead = 0;
	state.pile = null;
	state.passCount = 0;
	state.over = false;

	$('log').innerHTML = '';
	if(config.mode==='story') log('故事模式：新局開始（4 人）。');
	else log(config.players===2 ? '二人對戰：新局開始。' : '四人對戰：新局開始。');

	// 2P：先準備，再派牌
	if(config.players===2){
		await readyFlow2P();
	}

	const deck = buildDeck();
	deck.pop();

	// 你要求：2P 仍然每人 13 張（一副牌）
	const handSize = 13;
	for(let i=0;i<handSize;i++){
		for(const p of state.players){
			p.hand.push(deck.pop());
		}
	}
	for(const p of state.players){ sortHand(p.hand); }

	// ♦2 先手
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

// ---------- 對話框 ----------
function showStoryDialog(){
	const ch = currentChapter();
	if(!ch){
		$('storyText').textContent = '你而家係自由對戰（無章節）。\n如果想睇章節故事，請用「故事模式」。';
		$('dlgStory').showModal();
		return;
	}
	$('storyText').textContent = `${ch.title}\n\n${ch.story}`;
	$('dlgStory').showModal();
}

// ---------- UI 綁定 ----------
$('btnHelp').addEventListener('click', ()=> $('dlgHelp').showModal());
$('btnTitleHelp').addEventListener('click', ()=> $('dlgHelp').showModal());
$('btnCloseHelp').addEventListener('click', ()=> $('dlgHelp').close());

$('btnStory').addEventListener('click', ()=> showStoryDialog());
$('btnCloseStory').addEventListener('click', ()=> $('dlgStory').close());

$('btnSettings').addEventListener('click', ()=> $('dlgSettings').showModal());
$('btnTitleSettings').addEventListener('click', ()=> $('dlgSettings').showModal());
$('btnCloseSettings').addEventListener('click', ()=> $('dlgSettings').close());

$('setSfx').addEventListener('change', (e)=>{ settings.sfx = !!e.target.checked; });
$('setSpeed').addEventListener('change', (e)=>{ settings.speed = e.target.value; });

// 主頁 3 模式
$('btnNew').addEventListener('click', ()=> startNewGame({ mode:'story', players:4 }));
$('cardStory').addEventListener('click', ()=> startNewGame({ mode:'story', players:4 }));
$('card2p').addEventListener('click', ()=> startNewGame({ mode:'free', players:2 }));
$('card4p').addEventListener('click', ()=> startNewGame({ mode:'free', players:4 }));

$('btnPlay').addEventListener('click', ()=>{
	if(state.over) return;
	const cur = state.players[state.turn];
	if(!cur?.isHuman) return;

	const cards = getSelectedCards(state.turn);
	if(cards.length===0){ log('你尚未選牌。'); return; }

	const res = playCards(state.turn, cards);
	if(!res.ok){ log(`無法出牌：${res.reason}`, 'err'); return; }

	cur.selectedIdx.clear();
	if(!state.over) nextTurn();
	render();
	pumpTurns();
});

$('btnPass').addEventListener('click', ()=>{
	if(state.over) return;
	const cur = state.players[state.turn];
	if(!cur?.isHuman) return;

	cur.selectedIdx.clear();
	const r = passTurn(state.turn);
	if(!r.cleared) nextTurn();
	render();
	pumpTurns();
});

$('btnSkill1').addEventListener('click', ()=> log('技能按鈕已保留入口（版本 A），如要強化效果再擴充。'));
$('btnSkill2').addEventListener('click', ()=> log('技能按鈕已保留入口（版本 A），如要強化效果再擴充。'));

// ---------- 提示出牌 ----------
function syncHandSelectedClasses(pi){
	const p = state.players[pi];
	if(!p?.isHuman) return;
	const el = $(pi===0?'p0Hand':pi===1?'p1Hand':pi===2?'p2Hand':'p3Hand');
	if(!el) return;
	for(const child of el.children){
		const idx = Number(child.dataset?.idx);
		if(Number.isFinite(idx)) child.classList.toggle('selected', p.selectedIdx.has(idx));
	}
}
function applyHintForCurrentPlayer(){
	const cur = state.players[state.turn];
	if(!cur?.isHuman) return;
	cur.selectedIdx.clear();
	const hand = cur.hand;
	const pileEval = state.pile?.eval || null;
	const legal = [];
	// 1 張
	for(let i=0;i<hand.length;i++){
		const ev = evaluatePlay([hand[i]]);
		if(ev.ok && compareEval(ev, pileEval)) legal.push({ idxs:[i], ev });
	}
	// 2 張（對子）
	for(let i=0;i<hand.length;i++){
		for(let j=i+1;j<hand.length;j++){
			if(hand[i].rank!==hand[j].rank) continue;
			const ev = evaluatePlay([hand[i], hand[j]]);
			if(ev.ok && compareEval(ev, pileEval)) legal.push({ idxs:[i,j], ev });
		}
	}
	// 5 張（順子/同花/葫蘆/同花順）
	if(hand.length>=5){
		for(let a=0;a<hand.length;a++){
			for(let b=a+1;b<hand.length;b++){
				for(let c=b+1;c<hand.length;c++){
					for(let d=c+1;d<hand.length;d++){
						for(let e=d+1;e<hand.length;e++){
							const pick = [hand[a],hand[b],hand[c],hand[d],hand[e]];
							const ev = evaluatePlay(pick);
							if(ev.ok && compareEval(ev, pileEval)) legal.push({ idxs:[a,b,c,d,e], ev });
						}
					}
				}
			}
		}
	}
	if(legal.length===0){
		log('提示：冇可出嘅牌。');
		renderSelected();
		updateButtons();
		syncHandSelectedClasses(state.turn);
		return;
	}
	legal.sort((x,y)=> (x.ev.type-y.ev.type) || (x.ev.mainRank-y.ev.mainRank) || (x.idxs.length-y.idxs.length));
	for(const i of legal[0].idxs) cur.selectedIdx.add(i);
	log('提示：已幫你揀咗一手可出嘅牌。');
	renderSelected();
	updateButtons();
	syncHandSelectedClasses(state.turn);
}
// ---------- 發佈包裝：主頁 / 重新開始 ----------
function goHome(){
	for(const p of state.players){ if(p?.selectedIdx) p.selectedIdx.clear(); }
	setScreen('title');
	render();
}
async function restartGame(){
	if(!state.lastStartConfig){
		log('未有上一局設定，請由主頁開始。');
		goHome();
		return;
	}
	await startNewGame(state.lastStartConfig);
}
$('btnHome').addEventListener('click', ()=> goHome());
$('btnRestart').addEventListener('click', ()=> restartGame());
// Mobile：資訊浮動按鈕（開關左側資訊 panel）
const btnInfo = $('btnInfo');
if(btnInfo){
	btnInfo.addEventListener('click', ()=>{
		document.body.classList.toggle('infoOpen');
	});
}
$('btnHint').addEventListener('click', ()=>{
	if(state.over) return;
	applyHintForCurrentPlayer();
});
// ---------- 啟動 ----------
function boot(){
	$('subTitle').textContent = '單機 Web 版（模式：故事/2P/4P）';
	setScreen('title');
	render();
}

boot();
