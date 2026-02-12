(() => {
  const WORD_LEN = 5;

  // URL RAW do seu GitHub
  const WORDLIST_URL =
    "https://raw.githubusercontent.com/SieerK/termo/main/palavras-5.txt";

  // DOM
  const blocks = Array.from(document.querySelectorAll(".grid .block"));
  const keys = Array.from(document.querySelectorAll(".key"));
  const restartBtn = document.querySelector(".btn-restart");

  const ROWS = Math.floor(blocks.length / WORD_LEN);
  const MAX_ATTEMPTS = ROWS;

  let attempt = 0;
  let cursor = 0;
  let gameOver = false;

  let words = [];
  let dict = null;
  let secret = null;

  // trava entrada durante animação
  let isRevealing = false;

  // estado das teclas (não rebaixar cor)
  const keyState = new Map();
  const prio = { absent: 1, present: 2, correct: 3 };

  function normalize(s) {
    return s.toUpperCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  }

  function idx(r, c) {
    return r * WORD_LEN + c;
  }

  function blockAt(r, c) {
    return blocks[idx(r, c)];
  }

  function setBlock(r, c, letter) {
    const b = blockAt(r, c);
    if (!b) return;
    b.textContent = letter;
    b.dataset.letter = letter;
  }

  function clearBlock(r, c) {
    const b = blockAt(r, c);
    if (!b) return;
    b.textContent = "";
    b.dataset.letter = "";
  }

  function getLetter(r, c) {
    const b = blockAt(r, c);
    return (b?.dataset.letter || "").trim();
  }

  function getGuess(r) {
    let s = "";
    for (let c = 0; c < WORD_LEN; c++) s += getLetter(r, c);
    return s;
  }

  function isRowFilled(r) {
    for (let c = 0; c < WORD_LEN; c++) {
      if (!getLetter(r, c)) return false;
    }
    return true;
  }

  function shakeRow(r) {
    for (let c = 0; c < WORD_LEN; c++) {
      const b = blockAt(r, c);
      if (!b) continue;
      b.animate(
        [
          { transform: "translateX(0)" },
          { transform: "translateX(-6px)" },
          { transform: "translateX(6px)" },
          { transform: "translateX(-4px)" },
          { transform: "translateX(4px)" },
          { transform: "translateX(0)" }
        ],
        { duration: 220, iterations: 1 }
      );
    }
  }

  // ===== UI: linha ativa, cursor, bloqueio =====
  function updateActiveStyles() {
    blocks.forEach((b, i) => {
      const r = Math.floor(i / WORD_LEN);
      const c = i % WORD_LEN;

      b.classList.remove("active-row", "locked", "cursor");

      const hasResult =
        b.classList.contains("correct") ||
        b.classList.contains("present") ||
        b.classList.contains("absent");

      if (r !== attempt) {
        b.classList.add("locked");
        return;
      }

      // linha ativa só enquanto jogando e antes do resultado
      if (!gameOver && !hasResult) b.classList.add("active-row");
      if (!gameOver && c === cursor) b.classList.add("cursor");
    });
  }

  // Clique para mover cursor (só na linha atual)
  blocks.forEach((b, i) => {
    b.addEventListener("click", () => {
      if (gameOver || isRevealing || !secret) return;
      const r = Math.floor(i / WORD_LEN);
      const c = i % WORD_LEN;
      if (r !== attempt) return;
      cursor = c;
      updateActiveStyles();
    });
  });

  // ===== Teclas =====
  function paintKey(letter, state) {
    const L = normalize(letter);
    const current = keyState.get(L);
    if (current && prio[current] >= prio[state]) return;

    keyState.set(L, state);
    keys.forEach(btn => {
      const t = normalize(btn.textContent.trim());
      if (t === L) {
        btn.classList.remove("absent", "present", "correct");
        btn.classList.add(state);
      }
    });
  }

  // ===== Avaliação (com repetição correta) =====
  function evaluate(guess, secretWord) {
    const res = Array(WORD_LEN).fill("absent");
    const s = secretWord.split("");
    const g = guess.split("");

    // corretos
    for (let i = 0; i < WORD_LEN; i++) {
      if (g[i] === s[i]) {
        res[i] = "correct";
        s[i] = null;
        g[i] = null;
      }
    }

    // presentes
    for (let i = 0; i < WORD_LEN; i++) {
      if (g[i] == null) continue;
      const j = s.indexOf(g[i]);
      if (j !== -1) {
        res[i] = "present";
        s[j] = null;
      }
    }

    return res;
  }

  function isValidWord(guess) {
    if (!/^[A-Z]{5}$/.test(guess)) return false;
    return dict ? dict.has(guess) : true;
  }

  // ===== Flip (animação) =====
  function wait(ms) {
    return new Promise(res => setTimeout(res, ms));
  }

  // Ajuste de velocidade do flip:
  const FLIP_HALF_MS = 200;      // duração de cada metade (aumente pra ficar mais lento)
  const FLIP_STAGGER_MS = 160;   // intervalo entre letras (aumente pra cascata mais lenta)

  async function flipReveal(blockEl, stateClass, delayMs) {
    if (!blockEl) return;
    await wait(delayMs);

    const a1 = blockEl.animate(
      [{ transform: "rotateX(0deg)" }, { transform: "rotateX(90deg)" }],
      { duration: FLIP_HALF_MS, easing: "ease-in", fill: "forwards" }
    );
    await a1.finished;

    blockEl.classList.remove("absent", "present", "correct", "cursor", "active-row");
    blockEl.classList.add(stateClass);

    const a2 = blockEl.animate(
      [{ transform: "rotateX(90deg)" }, { transform: "rotateX(0deg)" }],
      { duration: FLIP_HALF_MS, easing: "ease-out", fill: "forwards" }
    );
    await a2.finished;

    blockEl.style.transform = "";
  }

  async function applyResultWithFlip(r, guess, res) {
    // pinta teclas já (fica ótimo e simples)
    for (let c = 0; c < WORD_LEN; c++) paintKey(guess[c], res[c]);

    const tasks = [];
    for (let c = 0; c < WORD_LEN; c++) {
      tasks.push(flipReveal(blockAt(r, c), res[c], c * FLIP_STAGGER_MS));
    }
    await Promise.all(tasks);
  }

  // ===== Entrada =====
  function addLetter(ch) {
    if (gameOver || isRevealing || !secret) return;
    const L = normalize(ch);
    if (!/^[A-Z]$/.test(L)) return;

    setBlock(attempt, cursor, L);
    if (cursor < WORD_LEN - 1) cursor++;
    updateActiveStyles();
  }

  function backspace() {
    if (gameOver || isRevealing) return;

    if (getLetter(attempt, cursor)) {
      clearBlock(attempt, cursor);
    } else if (cursor > 0) {
      cursor--;
      clearBlock(attempt, cursor);
    }
    updateActiveStyles();
  }

  function moveCursor(delta) {
    if (gameOver || isRevealing) return;
    cursor = Math.max(0, Math.min(WORD_LEN - 1, cursor + delta));
    updateActiveStyles();
  }

  function endGame(message) {
    gameOver = true;
    updateActiveStyles();
    if (restartBtn) restartBtn.hidden = false;
    setTimeout(() => alert(message), 50);
  }

  function pickNewSecret(prev) {
    if (!words.length) return prev || "CASAS";
    if (words.length === 1) return words[0];

    let next = prev;
    while (next === prev) {
      next = words[Math.floor(Math.random() * words.length)];
    }
    return next;
  }

  function newGame() {
    if (!secret) return;

    const prev = secret;

    attempt = 0;
    cursor = 0;
    gameOver = false;
    isRevealing = false;

    blocks.forEach(b => {
      b.textContent = "";
      b.dataset.letter = "";
      b.classList.remove("correct", "present", "absent", "cursor", "active-row", "locked");
      b.style.transform = "";
    });

    keys.forEach(k => k.classList.remove("correct", "present", "absent"));
    keyState.clear();

    secret = pickNewSecret(prev);

    if (restartBtn) restartBtn.hidden = true;
    updateActiveStyles();
  }

  async function submit() {
    if (gameOver || isRevealing || !secret) return;

    if (!isRowFilled(attempt)) {
      shakeRow(attempt);
      return;
    }

    const guess = getGuess(attempt);
    if (!isValidWord(guess)) {
      shakeRow(attempt);
      return;
    }

    const res = evaluate(guess, secret);

    isRevealing = true;
    await applyResultWithFlip(attempt, guess, res);
    isRevealing = false;

    if (guess === secret) {
      endGame("Você acertou! 🎉");
      return;
    }

    attempt++;
    cursor = 0;

    if (attempt >= MAX_ATTEMPTS) {
      endGame(`Fim de jogo! A palavra era: ${secret}`);
      return;
    }

    updateActiveStyles();
  }

  function handleInput(input) {
    if (gameOver || isRevealing) return;

    if (input === "ENTER") return submit();
    if (input === "BACKSPACE") return backspace();
    addLetter(input);
  }

  // ===== Teclado físico (com setinhas) =====
  window.addEventListener("keydown", (e) => {
    if (["ArrowLeft", "ArrowRight", "Backspace", "Enter"].includes(e.key)) {
      e.preventDefault();
    }

    if (e.key === "ArrowLeft") return moveCursor(-1);
    if (e.key === "ArrowRight") return moveCursor(1);

    if (e.key === "Enter") return handleInput("ENTER");
    if (e.key === "Backspace") return handleInput("BACKSPACE");

    if (e.key.length === 1) handleInput(e.key);
  });

  // ===== Teclado na tela =====
  keys.forEach(btn => {
    btn.addEventListener("click", () => {
      if (gameOver || isRevealing) return;
      const label = btn.textContent.trim();
      if (label.toUpperCase() === "ENTER") return handleInput("ENTER");
      if (label === "⌫") return handleInput("BACKSPACE");
      handleInput(label);
    });
  });

  if (restartBtn) restartBtn.addEventListener("click", newGame);

  // ===== Carregar lista =====
  async function loadWords() {
    try {
      const resp = await fetch(WORDLIST_URL);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const txt = await resp.text();

      words = txt
        .split(/\r?\n/)
        .map(w => w.trim())
        .filter(Boolean)
        .map(w => normalize(w))
        .filter(w => w.length === WORD_LEN && /^[A-Z]{5}$/.test(w));

      dict = new Set(words);
      secret = words[Math.floor(Math.random() * words.length)];
    } catch (err) {
      dict = null;
      secret = "CASAS"; // fallback
    }

    updateActiveStyles();
  }

  loadWords();
})();
