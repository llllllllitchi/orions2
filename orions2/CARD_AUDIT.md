# Orions 2 网页复刻 — 卡牌设定核对报告

核对日期：2026-10-31（第五次核对，已补入一手玩家实测资料）
数据来源：
- **S1 日文攻略站** iphoneac.com 六个属性页（水 / 火 / 風 / 土 / 生 / 死）——数值 + 效果文本
- **S4 TouchArcade 官方讨论帖**（1300+ 帖，2011-05~06，一手玩家实测）——**本轮新增，用于验证「游戏实际怎么跑」**
- 项目内 `js/cards2-data.js` 英文文案（仍属被核对对象，不单独作为依据）
核对范围：全部 116 张卡（73 生物 + 43 法术 / CAST）
配套交付：`Orions2_资料对照总表.xlsx`（9 个来源、116 张卡三列并排、15 条差异、12 条原版 bug）

---

## 〇、资料来源与可信度（第五次核对已重写）

前几轮只有**一个**外部信源（日文攻略站），导致两次误判。本轮补入了 TouchArcade 上 2011 年游戏刚上线时的官方讨论帖——那批玩家逐张实测、贴数值、报 bug，是目前唯一能验证「游戏实际运行行为」的资料。

| 来源 | 性质 | 能当权威吗 |
|---|---|---|
| **S1** iphoneac 六个属性页 | 日本玩家攻略站，日文，非官方 | **数值与效果文本可信**；但会漏写费用行（见第九章） |
| **S4** TouchArcade 官方讨论帖 | 2011 年一手玩家实测，1300+ 帖 | **验证运行行为的最佳来源**；但转述可能记错（Fairy 即一例），需与 S1 交叉 |
| `js/cards2-data.js` 英文文案 | 被核对对象本身 | 不能单独作依据；但**其措辞与语法特征**可作为旁证（见下） |
| `assets/cards2/*.gif` | 网站抓的卡面 | 只有费用/生命/攻击/卡名，无规则文字 |
| 英文原版卡面 / 游戏本体 | 未取得 | — |

**三条判据（本轮建立）：**

1. **数值以 S1 为准**，S1 缺项时看 S4；两者都缺则标存疑。
2. **效果语义以 S1 为准**，S4 只用于验证「实际跑起来是什么样」。
3. 当 S1 与 S4 冲突且都能自洽时，**判为版本分歧或原版 bug，不再强行二选一**。

**关于项目英文文案的来源**：S4 帖中 amn624（beta 测试者）说 *"I'm working on an overhaul for all the text in the game since in its current state there are many grammar errors and awkward English"*——原版英文本身就有大量语法错误。而项目文案里 `it's health less than 7`、`in its' turn`、`its own owner` 这类错误的特征与此吻合。**因此项目英文文案很可能确实来自游戏原版文本**，只是无法 100% 证实。本轮把它降级为「旁证」，不作为判决依据。

---

**（以下为原报告主体）**


---

## 一、总体结论

| 核对项 | 结果 |
|---|---|
| 费用 / 攻击力 / 生命 / 购买费 | **116 张全部一致**（唯一例外：EARTHQUAKE 的购买费，见 C2） |
| 属性归属、生物/法术类型 | 全部一致 |
| CAST 费用与元素 | 33 张与 S1 一致；**GIANT SPIDER 经一手实测确认 1.0 版为 0 费**，项目写 2 土 → 见 A1 |
| 效果实现覆盖率 | 100%，每张有文案的卡都有对应 effects 条目；所有钩子都被引擎调用 |
| 卡图 | 116 张齐全，无重复、无错配 |
| 阈值严格性（「以下 / 未满」边界） | 15 张全部正确；SCARELING 已由一手玩家明确 "health < 7" 佐证 |
| AI 对局 100 局压力测试 | 0 崩溃、0 异常数值、0 NaN |

**结论：数值层干净。** 真正需要处理的是三条：**SCYLLA 已确认无问题（撤销）**、**UNDEAD SWARM 会打脸（确认 bug）**、**GIANT SPIDER 蛛网费用存在版本分歧**。另有 CHIMERA 改写了规则、5 处数据/文案错值。

> 修订记录（2026-10-31 五次核对）：**撤销 A1「SCYLLA 加错人」。** 补入 TouchArcade 一手玩家记录后，日文原文、项目文案、玩家实测三方一致指向「对手用水卡 → 对手自己加水」，**项目代码是正确的**，Scylla 在原作里本就是「资敌」的差卡。前次判错的原因是把日文页首「オーナー＝控制该生物的玩家」这条通用定义硬套到了这一条上，而这条的指代是「出水卡的那一方」。
>
> 修订记录（2026-10-31 四次核对）：撤回「卡面原文」表述。项目内英文文案出自 `js/cards2-data.js`，卡面图无规则文字，外部无英文原版资料。该判据前提不成立，相关条目曾改为存疑；**五次核对已通过一手玩家资料解决其中大部分**。
>
> 修订记录（2026-10-31 三次核对）：原报告称「CAST 费用 33 张全部一致」不准确——脚本实际标出 5 张日文页缺费用行。详见第九章附注。

---

## 二、A 级：影响对局平衡（建议优先修）

### A1. GIANT SPIDER — 蛛网到底收不收费（土，费 6，18/4）

**这是全表唯一一处「官方文本」与「实际运行」直接冲突的地方，而且我前几轮反复改口。**

| 来源 | 说法 |
|---|---|
| S1 日文站 | **没有「コスト」行**（同页 ENT / ELVEN ARCHER / PYTHON 也没有，那 3 张确实 0 费） |
| 项目数据 | `castCost: 2, castElement: 'earth'`；文案写 `Costs 2 Earth.` |
| **S4 一手玩家（2011-05~06，至少 3 人独立）** | **0 费**。证据见下 |

原始引用：
> **Rasten #483**：*"Another badass card--**the casting ability costs nothing**, and can effectively shut down an opponents' high attack creature."*
> **amn624 #521**（beta 测试者）：*"**Negate attack with 0 cost** + 18 health + 4 power for 6 means it is already under priced"*
> **Rasten #527**：*"the real issue I see is with the **free cost of web**"*
> **n1k170n #1388**：*"**If its cast will cost 1 Earth** you will be able to cast only 1-2 Spiders during a duel."*

关键点：**2011 年 6 月，玩家们正在反复呼吁「应该给蛛网加价」**（提议 1 土或 2 土）。如果当时已经收费，就不会有人提这个。所以 **1.0 版蛛网确定是 0 费**。

**判定**：版本分歧。三种可能：
1. 原版文案写 `Costs 2 Earth` 但代码没实现扣费（原版 bug）——最可能，与 S4 中大量「描述与实际不符」的 bug 记录风格一致；
2. 后续更新按玩家建议改成了 2 土，项目采用了新版本；
3. 项目作者自行补的。

**建议**：如果你要对齐「1.0 版体验」，改成 0；如果要平衡，2 土正是当年玩家想要的方向。**本质是产品选择，不是修 bug。**

---

### ~~A1-旧. SCYLLA — 水元素加错了人~~ 【已撤销，代码正确】

前次审计判定 Scylla 把水加给了对手，属「强度反转」。**这个结论是错的，代码无需改动。**

理由是三方独立一致：

| 来源 | 原文 |
|---|---|
| S1 日文 | 敵が水属性のカードを使う度にオーナーの水マナが +1 |
| 项目文案 | Whenever an enemy uses a Water card, **its owner** gains 1 Water |
| **S4 一手玩家** | *"Whenever your opponent casts a Water spell or creature, **he** then gains 1 Water element."* + *"This card is horrible... **It'll just pump up your opponent's Water**"* |

意思是：**对手用水属性卡时，对手自己得 1 水**。代码 `g.gain(g.player(summoned.owner), 'water', 1)` 正是这个意思，**实现对**。

而且 Scylla 在原作里本来就是被玩家骂的差卡（"useless"、"horrible"），「资敌」正是它的设计特征。前次判错的原因：把日文页首「オーナー＝控制该生物的玩家」这条**通用定义**硬套到了这一条上，但这条的指代其实是「出水卡的那一方」。

---

### A2. UNDEAD SWARM — 不该能打敌方玩家（死，费 1）

**原作**：
> 味方の死属性クリーチャーが正面の敵クリーチャーに攻撃を行う（**敵プレイヤーへの攻撃は行えない**）

**当前实现**（`js/effects2.js:1242`）
```js
const o = g.opposite(c);
if (o) await dmg(g, o, g.attackValue(c), ...);
else await dmgPlayer(g, g.player(g.enemy(p.id)), g.attackValue(c), ...);  // ← 多加的
```

**问题**：对面空槽时会直接打玩家。原作明确禁止这一分支。
**影响**：1 费卡变成「全体亡灵免费再攻击一轮，空槽直接打脸」，强度明显高于原作。英文/中文说明也跟着写错了（"对面为空时攻击敌方玩家"）。
**修法**：删掉 `else` 分支；同时改 `cards2-data.js` 的 `ability` 与 `cards2-zh.js` 的中文说明。

---

### A3. SCARELING — 攻击门槛（**已定案：代码正确**）

**结论：`canAttack: (g, c) => c.hp >= 7` 正确，7 点生命可以攻击，无需改动。**

本轮在 TouchArcade 帖中找到了直接的一手证据——玩家 n1k170n 在 2011 年 5 月的 bug 报告里原样引用了这张卡的描述：

> **#501**：*"I had Scareling with 5 HP at the beginning of my turn. As we know from the description **it doesn't attack if its health < 7**."*

玩家是在**引用游戏内描述**来报告一个 bug（他给 Scareling 加到 8 血后当回合仍没攻击）。这条引用的措辞是 `< 7`，与日文页的「７以下」不同。

另外，同一批玩家引用的其他卡阈值也都是同一套写法（`4 or less` 含、`less than 10` 不含），说明原版文案对两种表述区分严格。**日文站的「以下」是攻略作者的笼统转述。**

附带确认：「满生命双倍伤害」已实现于 `js/engine.js:787`（`c.hp === c.maxHp → a *= 2`），正确。

---

## 三、B 级：规则与原作不一致

### B1. CHIMERA — 法术费用「减半」vs「退还一半」（生，费 13）

**原作**：
> オーナーが魔法を使用後、**コストの半分のマナが戻ってくる**

即：**必须付得起全额**才能施放，施放后返还一半。

**当前实现**（`js/engine.js:362`）
```js
if (this.hasChimera(p)) cost = Math.floor(cost / 2);   // 直接把费用减半
```

**差异**（三处实质区别）：
1. 玛娜不够全额时：原作**不能施放**，现在**能施放**；
2. 对「按当前玛娜结算」的法术（Chain Lightning、Steal Life、Fire Burst、Rejuvenation），结算时的玛娜量不同 → 伤害不同；
3. 与「禁咒」挑战叠加时，原作是 ×2 之后退还一半（净 0.5 倍），现在是 ×2 再 ÷2（净 1 倍）。

**备注**：README 把这写成"修复了 CHIMERA 法术费用减半"，实际上是把原作规则改掉了。要不要还原，取决于你是想还原原作还是想让它更顺手。

---

## 四、C 级：数据 / 文案错值

| 编号 | 卡 | 位置 | 现状 | 应为 |
|---|---|---|---|---|
| C1 | ASSASSIN | `cards2-data.js:2546` | 英文文案写 `Cost 4 Death` | **3**（原作「コスト：死マナ -3」，数据 castCost=3 是对的，只有文案错） |
| C2 | EARTHQUAKE | `cards2-data.js:1898` | `"price": 0` | 原作是**土 70 / 火 50** 双色水晶，抓取时无法解析被置 0 |
| C3 | APOSTATE | `cards2-data.js`（1954 行段） | `castElement: 0` | `"death"`。UI 回退到卡牌自身属性，显示成「0 生」，但它的效果是变成**死**属性女妖 |
| C4 | BLADE MASTER | `cards2-data.js:739` | `castElement: 0` | `"fire"`。UI 靠回退显示正常，属脏值 |
| C5 | SHADOW | `cards2-data.js`（2429 行段） | `castElement: 0` | `"death"`。同上，靠回退兜住 |

> C4/C5 目前不影响显示，但 `castElement: 0` 会在 `getAbilitySpec` 里走 `0 || card.element` 的回退路径，一旦以后改动回退逻辑就会暴露。

---

## 五、D 级：显示缺失 —「变动」数值没渲染

数据里已经标了 `atkVar` / `hpVar`，但 **ui.js / ai.js 全文没有引用这两个字段**。

后果（卡牌悬停说明、图鉴里显示的都是 `card.atk` / `card.hp`）：

| 卡 | 字段 | 当前显示 | 原作 |
|---|---|---|---|
| TENTACLE | 攻击 | 0 | 変動 |
| ELEMENTAL（水） | 攻击 | 0 | 変動 |
| ELEMENTAL（火） | 攻击 | 0 | 変動 |
| MOLOCH | 攻击 | 0 | 変動 |
| SOUL OF WINDS | 攻击 | 0 | 変動 |
| AVATAR | 生命 | 0 | 変動 |

**修法**：在 `ui.js:157-158`（`card-tip` 渲染）和卡面角标（`ui.js:527` / `563`）读一下 `card.atkVar` / `card.hpVar`，是 `true` 就显示「变动」。

---

## 六、E 级：工程隐患（不影响当前玩法）

### E1. effects2.js 里的 `castCost` / `castTarget` 是死数据

`engine.js:486-488` 的 `getAbilitySpec` 只读卡数据：
```js
let type = c.card.castTarget || fx.castTarget || 'none';
const el = c.card.castElement || c.card.element;
let amount = c.card.castCost || 0;
```
116 张卡的 `castTarget` 全部有值、`castElement` 全部有值，所以 **effects2.js 里 55 处 `castCost` 和 58 处 `castTarget` 从来不会生效**。

其中 7 处与卡数据**互相矛盾**，说明当初改的是这一层、以为生效了：

| 卡 | effects2.js 里写的 | 卡数据（实际生效） |
|---|---|---|
| OCEAN LORD | 3 水 | 1 水 |
| NIXIE | 水 0 | 火 1 |
| ELEMENTALIST | 水 0 | 每系 1 |
| LEVIATHAN | 水 0 | 水 1 |
| LICH | 死 0 | 死 5 |
| SATYR | 土 0 | 土 1 |
| ASSASSIN | 死 4 | 死 3 |

**建议**：要么删掉 effects2.js 里这些字段（只留 `castFilter` / `castCheck` / `castReason` 这些真生效的），要么让 `getAbilitySpec` 改成 `fx.castCost || c.card.castCost`（以 effects 为准）。留两套必然踩坑。

### E2. 死代码

- `effects2.js` 里有 **43 个 id 不属于本作 116 张卡**（`flaming-arrow`、`devil`、`fireball`、`waterfall`、`poseidon`、`titan`、`paladin`、`vampire`、`zombie` 等），是 Orions 经典版遗留。
- `E['astral-cloud']` 在 `effects2.js:678` 和 `:974` **定义了两次**（都是空对象，无害但重复）。
- `engine.js` 里同批死 id 的特判也在（`elemental` 的 +10、`rust` 的 `dmg += 0`、`liches` 的 `dmg += 0`、`paladin`、`unicorn`、`ice-guard`、`vampire`）。

---

## 七、F 级：确认未实现（README 已自认）

**ASTRAL CLOUD**（风，费 7）—— 原作：
> 正面の敵が使う CAST のマナコストを３増やす。**もし相手のマナが足りない場合は３のダメージを与える**

前半（费用 +3）已实现（`engine.js:489-490`）；后半「付不起就受 3 点伤害」**没有实现**，现在的情况是费用不够就直接无法施放。README「已知差异」里已列出。

---

## 八、存疑（原作表述含糊，需你判断）

1. **ENSLAVE**（死，费 11）：原作「自軍に空きスロットが必要」（**需要空位**，未说几个）；当前实现要求 **2 个**空槽，否则目标死亡。README 说是按卡面要求，但攻略站原文只写"需要空位"。
2. **GUARDIAN**（风，费 8）：原作「任意の味方クリーチャーが受けるダメージを代わりに受ける」**没有时限**；当前实现给了约 1 回合（`protectUntil = turn + 2`）。
3. **ELEMENTAL（水）**：原作「場の全ての水属性クリーチャーの**ライフ** +3」。当前实现加的是**最大生命**（`buffMaxHp`），不是当前生命。
4. **STARFALL**：原作「全ての**敵**に…ダメージ」，"敵"可能包含敌方玩家；当前只打敌方生物。

---

## 九、已核对无误的重点（供参考）

以下几处是最容易出错、但实际写对了的：

- **多重攻击伤害倍率**：CERBERUS 相邻目标 `mult: 0.5`、HYDRA 三格全伤害、TENTACLE 打全体、ENT 打正面+玩家 —— 与原文一致。
- **所有权类效果**：GRIM REAPER / DARK LORD / DARK DRUID / DIABLO / **SCYLLA** 全部按正确对象结算（SCYLLA 前次误判为错，本轮已平反，见 A1-旧）。
- **反击与减伤**：SWORDSMAN（仅正对面）、ICE WALL（2 点）、GHOST（生物伤害减半 / 法术双倍 + 主人 -1）、SHADOW（减半最低 1 / 被生系攻击 +5）、KOBOLD（≤4 无视）全部正确。
- **即死与门槛**：GIANT TURTLE（≤9 生命即死）、PYTHON（≤5）、GRIM REAPER（≤3 费）、ASSASSIN（<10 生命）、ZEUS（≤6 费用可用）、**SCARELING（<7 不攻击，已由一手玩家佐证，见 A3）** 全部正确。
- **特殊状态**：BERSERKER 自伤走独立扣血（不会被自己的「受伤 +2」二次放大）、TYTHON 施法前置检查、LEVIATHAN 支付前检查水 >6、LICH 费用不足时扣 10 生命（`Death Bolt` 特判，spellName 对得上）。
- **IMP 的「生命 ≤4 死亡」**：在扣血后单独判定，正确。
- **CAST 费用扣除路径**：`getAbilitySpec` 读 `c.card.castCost`（engine.js:488）。这条链路本身没问题——扣费确实按卡数据走，不存在「写了没生效」。问题只在于**卡数据里的费用对不对**，见下。

### 附注：5 张卡日文页缺费用行——本轮已有一手答案

日文攻略站对这 5 张卡**没有「コスト：Xマナ」这一行**。本轮在 TouchArcade 帖里找到了其中 1 张的确定答案，其余 4 张仍缺。

| 卡 | 日文页 | 项目数据 | 一手玩家（S4） | 判定 |
|---|---|---|---|---|
| **GIANT SPIDER** | 无费用行 | 2 土 | **0 费**（3 人独立确认，且当时正在讨论要不要加价） | **项目与 1.0 版不符**，见 A1 |
| ZEUS | 无费用行 | 1 风 | 无记录 | 未知 |
| MANTICORE | 无费用行 | 2 风 | 无记录 | 未知 |
| GUARDIAN | 无费用行 | 1 风 | 无记录 | 未知 |
| KRAKEN | 无费用行 | 3 水 | 无记录 | 未知 |

同页 ENT / ELVEN ARCHER / PYTHON 也没有费用行，而那 3 张确实 0 费——所以「没写」在日文页上既可能是「免费」也可能是「漏写」，无法区分。

**但 GIANT SPIDER 这条已经可以确认：1.0 版是 0 费。** 这也反过来说明，日文页「没写费用行」大概率就是「免费」，而不是「漏写」——至少对蜘蛛是这样。剩下 4 张可以按同样思路推定为 0 费，但**不应直接改成 0**，因为 2 风/3 水的技能强度明显不适合白嫖。

---

## 九附、本轮从一手资料得到的额外发现

以下都是 TouchArcade 帖里记录、但日文站完全没提的信息，对你的复刻有直接参考价值。

### 1. 与项目无关、但影响「还原度判断」的原版 bug（共 12 条，详见 Excel「④ 原版已知BUG」）

举三个最影响手感的：

- **ENSLAVE 需要 2 个空槽**（描述写 1 个）。*"The description says that you need one free slot, but really you need two."* 项目文案把「2 个」写进去了——**等于把原版 bug 写成了正式规则**。
- **DIABLO 是施放火法术时产火**（+2~+5 不等），不是「火生物死亡时」。项目文案写的是后者。
- **KNIGHT 的治疗实际治在「最不需要治疗」的生物上**——原版实现有 bug。项目文案写的是正确逻辑（治疗生命最低者），**项目是对的**。

### 2. 一处玩家转述错误（提醒：S4 也会错）

Rasten 在 #483 把 FAIRY 记成「场上每有生物死亡就 +1 攻」，与日文原文「**被击倒时**友方全体 +1 攻」完全不同。经日文原文核对，**项目数据是对的**。这说明 S4 必须与 S1 交叉，不能单用。

### 3. 原版设计意图的旁证（有助于你判断「该不该修」）

- **CHIMERA**：玩家实测「2 Chimeras => Free spells」——两张叠加后法术全免，说明是**50% 累加减免**，不是「先付后返」。日文原文写的是「返还一半」。两者在原版里可能就不一致。
- **GIANT SPIDER 当年是公认最强卡**：*"Giant Spider and Fairy are obviously the most cost friendly and OP cards."*（#520）、*"Giant Spider is easily the most mentioned."*（#1422，指被要求削弱最多）。
- **卡池规模**：开发者 amn624 明确说 **116 cards**（#493），与你的数据和日文站一致——官网宣传的「120 张」是营销口径。

---

## 十、修复优先级建议

| 顺序 | 项 | 改动量 | 性质 |
|---|---|---|---|
| 1 | A2 UNDEAD SWARM 打玩家 | 删 1 行 + 改 2 处文案 | **确定 bug** |
| 2 | C1-C5 数据/文案错值 | 5 处单值替换 | 确定错值 |
| 3 | D1 变动数值渲染 | ui.js 3 处 | 显示缺失 |
| 4 | A1 GIANT SPIDER 蛛网费用 | 1 个数值 | **产品选择**（0=还原 1.0，2=当年玩家想要的平衡） |
| 5 | B1 CHIMERA 机制 | 需先定调 | 产品选择 |
| 6 | E1/E2 清理死代码 | 可选 | 工程卫生 |
| — | ~~SCYLLA~~ | 不需要动 | **已撤销** |

---

## 附：本轮搜集到的全部资料来源

| 编号 | 来源 | 性质 | 覆盖内容 | 可靠性 |
|---|---|---|---|---|
| S1 | [iphoneac.com Orions 2 攻略](https://iphoneac.com/orions2.html)（6 个属性页） | 日文攻略站 | 116 张卡全覆盖：费用/攻/血/买价/被动/CAST 费用 | 高（数值+文本），但会漏费用行 |
| S4 | [TouchArcade 官方讨论帖](https://www.toucharcade.com/community/threads/orions-2-by-chillingo-lite.94613/)（1300+ 帖，2011-05~06） | **一手玩家实测** | 约 25 张卡的数值+效果原文、12 条原版 bug、平衡讨论、开发者互动 | **高**（多人交叉），但转述会记错 |
| S3 | [查字典《Orions 2 图文攻略》](https://www.chazidian.com/zl/gonglue/35830) | 中文攻略 | 规则名词、界面说明、6 张全卡牌图鉴大图 | 中（无逐卡数值） |
| S5 | Metacritic / 148Apps / TouchArcade / GodisaGeek / CapsuleComputers 评测 | 媒体评测 | 玩法结构、双排五格战场、元素资源 | 中（规则层） |
| S6 | [MoreGames 官网 Orions: Deckmasters](https://pocketmoregames.com/orions_addon2.htm) | 官方（一代资料片） | 45 张新卡、Custom Decks / Draft | 中 |
| S7 | [ThoughtsMedia Orions 一代长篇评测](https://forums.thoughtsmedia.com/archive/index.php/t-86285.html) | 一手玩家深度分析 | Tython/Kraken/Scylla/Knight/Pegasus/Chimera 机制细节 | 中高（一代，机制多沿用） |
| S8 | [archive.org Orions 条目](https://archive.org/details/OrionsLegendOfWizards) | 存档/官方文案 | 一代：6 系、75 张卡 | 中 |
| S9 | 项目复刻数据（cards2-data / cards2-zh / effects2 / engine） | 待核对对象 | 116 张卡 + 实现 | — |

**没找到的**：英文版游戏内卡面文字、官方 patch notes、IPA 可提取文本、俄语区资料、wiki/fandom 专页。App Store 页面已下架（重定向到 Today 页）。

**配套 Excel**：`Orions2_资料对照总表.xlsx`（放在本文件同目录之外的你自己的工作区），六个页签——说明 / 资料源清单 / 全卡三列对照 / 15 条关键差异 / 12 条原版 bug / 20 条一手原文引用。

~~原第 3 项「A3 SCARELING 边界」已撤销~~，代码无需改动。

---

## 十一、本轮修复状态（2026-10-31）

玩家反馈与报告交叉后，以下项目已实际修改：

- **RED DRAKE**：火系法术现在通过施法元素快照识别，Fire Spikes / Fire Storm / Blood Ritual 等不再绕过火免疫；火系生物的攻击和 CAST 也按来源属性免疫。
- **EVIL SORCERER**：免疫所有 `spell` 与 `ability`，包括 ELVEN ARCHER 的 Fire Arrow、Berserker 的 Berserk；只有另一个 Evil Sorcerer 的能力能穿透。普通攻击仍有效。
  - 实测免疫边界（`probe_es5.js`）：
  - 免疫：所有法术和 CAST 能力伤害。
  - 打穿：普通攻击（`kind:'attack'`）、另一只 EVIL SORCERER 的 Burning Hands、中毒/代价/侵蚀。
  - 非伤害效果仍可能绕过免疫，例如 BLIND / PARALYZE / RUST / POISON STORM 这类状态。

- **A2 UNDEAD SWARM**：删除“对面为空时打玩家”的分支；英文/中文说明同步为“对面为空时不攻击”。
- **C1**：ASSASSIN 文案的费用从 4 改为 3 Death。
- **C2**：EARTHQUAKE 的 price 从 0 改为 70（原作为土/火双色，当前数据结构只存一个价格）。
- **C3/C4/C5**：APOSTATE→death、BLADE MASTER→fire、SHADOW→death，`castElement` 脏值已清理。
- **D1**：卡牌悬停、卡面角标、卡牌详情对 `atkVar` / `hpVar` 显示“变动”。
- **F ASTRAL CLOUD**：对面施法费用 +3；付不起时，施法者受到 Astral Cloud 的 3 点伤害，不再只是简单禁止施法。
- **B1 CHIMERA**：已按原作改为“必须付得起全额，施法后返还一半”；两个 Chimera 返还全额。卡面文案同步。
- **A1 GIANT SPIDER**：按玩家定案改为 **1 土**（不再使用 2 土）。
- **A3 SCARELING**、**SCYLLA**：维持原判断，代码正确。
- **SALAMANDER**：光环只给其他友方生物 +2；自己仍是 3，除非有第二个。
- **SOUL OF WINDS**：任何来源造成伤害都固定 -20；攻击力实时等于对面当前攻击。
- **BERSERKER**：Berserk 属于 CAST 能力，Evil Sorcerer 仍免疫；AI 面对完全免疫目标不会再施放，按钮也会变灰。
- **FIRE WALL / ICE WALL**：不参与攻击回合，攻击力固定为 0，不受攻击加成影响。
- **统计面板**：记录总场次/胜负/胜率/回合/击杀/双人 P1-P2，以及每张卡的出场、召唤、法术、能力、伤害、击杀、治疗。
- **SCARELING**：满血时卡面固定显示 3 攻；实际攻击结算时才翻倍为 6。
- **ZEUS**：Lightning 费用为 1 风（此前误改为 4 风，已回退）。
- **FAIRY**：Enslave Mind 使用实时攻击力，Soul of Winds 也能被强制攻击拥有者。
- **SEA MONSTER**：战斗阶段按出手前快照逐个攻击；移动后不会重复攻击。
- **LIGHTNING LORD**：Lightning 按使用前 Air 结算，再扣 3 Air。
- **ETHEREAL**：只免疫普通物理攻击和定向直伤；范围法术、中毒/锈蚀、即死、Moloch 入场、Evil/Lich 魔法攻击可伤害它。
- **EVIL SORCERER**：魔法伤害、buff、debuff、属性改变全部免疫；攻击固定 5；普通物理攻击和 ELVEN ARCHER physical 技能可伤害它。
- **GUARDIAN + 范围法术**：Guardian 先吃自己的那份，再吃替保护目标承受的那份，群体法术下共两份。
- **先手选择**：支持玩家 1 / 玩家 2 / 随机先后；局域网由房主解析随机并同步。
