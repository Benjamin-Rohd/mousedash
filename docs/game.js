  import { app, analytics, database, beginGame, endGame, watchHighscore } from "./firebase-init.js";
  import { ref, get, set, onValue, runTransaction } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-database.js";

  const config = {
    type: Phaser.AUTO,
    width: 550,
    height: 450,
    parent: 'game-container',
    backgroundColor: "#ffffff",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    physics: { default: "arcade" },
    scene: { preload, create, update }
  };

  let player, enemies, score = 0, scoreText, active_fl = 0, num_enemies, worldBounds, gameWidth, gameHeight, difficulty, total_velocity, mute, popSound;
  
  const scoreRef = ref(database, "dailyHighscore");

  document.querySelector("#difficultyGroup").addEventListener("change", difficultyChanged);
  document.querySelector("#mute").addEventListener("change", muteChanged);

  const game = new Phaser.Game(config);
 
  function preload() {

    this.load.audio('pop', ['pop.mp3']);

  }
  
  function create() {

    active_fl = 0;
    num_enemies = 20;
    difficulty = document.querySelector('input[name="difficulty"]:checked').value;
    updateTotalVelocity();
    mute = document.querySelector("#mute").checked;
    gameWidth = this.sys.game.canvas.width;
    gameHeight = this.sys.game.canvas.height;

    popSound = this.sound.add('pop');
    
    player = this.add.circle(400, 300, 12, 0x000000);
    this.physics.add.existing(player);
    player.body.setCollideWorldBounds(true);
    player.setActive(false).setVisible(false);
  
    enemies = this.physics.add.group();
    for (let i = 0; i < num_enemies; i++) {
      let spawn = generateSpawn();
      const enemy = this.add.circle(spawn.x_pos, spawn.y_pos, 10, 0xaaaaaa);
      this.physics.add.existing(enemy);
      enemies.add(enemy);
      enemy.body.setVelocity(spawn.x_vel, spawn.y_vel);
    }
  
    scoreText = this.add.text(10, 10, "Score: 0", { font: "16px Arial", fill: "#000" });

    worldBounds = this.physics.world.bounds;
  
    this.physics.add.overlap(player, enemies, hitEnemy, null, this);
  
    // follow mouse
    this.input.on('pointermove', pointer => {
      player.x = pointer.x;
      player.y = pointer.y;
    });

    // click to start
    this.input.on('pointerdown', function (pointer) {
        if (active_fl == 0) {
            player.setActive(true).setVisible(true);
            score = 0;
            active_fl = 1;
            if (difficulty === "hard") {
              beginGame();
            }
        }
    });
  }
  
  // update - timer
  function update(time, delta) {
    if (active_fl == 1) {
        score += delta / 1000;
    }
    scoreText.setText("Score: " + score.toFixed(1));

    // respawn enemies when they are out of the canvas
    enemies.getChildren().forEach((child, index) => {
        let spriteBounds = child.getBounds();
        if (!Phaser.Geom.Rectangle.Overlaps(worldBounds, spriteBounds)) {
            let spawn = generateSpawn();
            child.x = spawn.x_pos;
            child.y = spawn.y_pos;
            child.body.setVelocity(spawn.x_vel, spawn.y_vel);
        }
    });

  }
  
  // die
  async function hitEnemy() {
    if (active_fl == 1) {

        player.setActive(false).setVisible(false);
        active_fl = 0;
        
        // play pop sound if not muted
        if (!mute) {
          popSound.play();
        }

        // check high score if on hard mode
        if (difficulty === "hard") {
          try {
            //await submitScore(score);
            const isNewHighScore = await checkScore(score);

            if (isNewHighScore) {
              const message = await showHighScorePrompt();
              const clean_message = sanitizeMessage(message).trim();

              // replacing old submit score func
              await endGame(score, clean_message);
              //await submitScore(score, clean_message);
            }
          } catch (err) {
            console.error("High score flow failed:", err);
          }
        }   
    }
  }

  // generate random start location and direction for enemies
  function generateSpawn() {
    const rand = Phaser.Math.Between(0, 3);
    let x_pos, y_pos, x_vel, y_vel;
    // left
    if (rand == 0) {
        x_pos = 0;
        y_pos = Phaser.Math.Between(0, gameHeight);
        y_vel = Phaser.Math.Between ((-1 * total_velocity / 2), (total_velocity / 2))
        x_vel = total_velocity - Math.abs(y_vel);
    // top
    } else if (rand == 1) {
        x_pos = Phaser.Math.Between(0, gameWidth);
        y_pos = 0;
        x_vel = Phaser.Math.Between ((-1 * total_velocity / 2), (total_velocity / 2))
        y_vel = total_velocity - Math.abs(x_vel);
    // right
    } else if (rand == 2) {
        x_pos = gameWidth;
        y_pos = Phaser.Math.Between(0, gameHeight);
        y_vel = Phaser.Math.Between ((-1 * total_velocity / 2), (total_velocity / 2))
        x_vel = -1 * (total_velocity - Math.abs(y_vel));
    // bottom
    } else {
        x_pos = Phaser.Math.Between(0, gameWidth);
        y_pos = gameHeight;
        x_vel = Phaser.Math.Between ((-1 * total_velocity / 2), (total_velocity / 2))
        y_vel = -1 * (total_velocity - Math.abs(x_vel));
    }
    return {x_pos, y_pos, x_vel, y_vel};
  }

  function updateTotalVelocity() {
    if (difficulty === "easy") {
      total_velocity = 150;
    } else if (difficulty === "hard") {
      total_velocity = 250;
    } else {
      total_velocity = 200;
    }
  }

  function difficultyChanged(event) {
    difficulty = event.target.value;
    if (difficulty === "easy") {
      total_velocity = 150;
    } else if (difficulty === "hard") {
      total_velocity = 250;
    } else {
      total_velocity = 200;
    }

    resetScore();
  }

  function muteChanged(event) {
    mute = document.querySelector("#mute").checked;
  }

  // reset score function for change of radio buttons - need to make it globally accessible
  function resetScore() {
    score = 0;
  }

  // check if score is a new high score
  async function checkScore(new_score) {
    try {
      const snapshot = await get(scoreRef);
      if (!snapshot.exists() || Number(new_score.toFixed(1)) > Number(snapshot.val().score ?? 0)) {
        return true;
      } else {
        return false;
      }
    } catch (err) {
      console.error("Could not check high score:", err);
      return false;
    }
  }

// call updateHighScoreUI() each time a new value arrives in the database
onValue(scoreRef, (snapshot) => {
    let data;
    if (snapshot.exists()) {
      data = snapshot.val();
    } else {
      data = { score: 0, message: "-" };
    }

    const score = data.score ?? 0;
    const message = data.message ?? "-";

    const scoreElem = document.getElementById("currentHighScore");
    scoreElem.textContent = `${score.toFixed(1)}`;

    const messageElem = document.getElementById("currentMessage");
    messageElem.textContent = `"${message}"`;
 }, (err) => {
  console.error("High score listener failed:", err);
  document.getElementById("currentHighScore").textContent = "—";
}); 

// MODAL

function showHighScorePrompt() {
  return new Promise((resolve) => {
    const modal = document.getElementById("highScoreModal");
    const input = document.getElementById("highScoreMessage");

    modal.classList.remove("hidden");
    input.value = "";
    input.focus();

    document.getElementById("submitMessage").onclick = () => {
      modal.classList.add("hidden");
      resolve(input.value.trim());
    };

    // document.getElementById("skipMessage").onclick = () => {
    //   modal.classList.add("hidden");
    //   resolve("");
    // };
  });
}

const input_field = document.getElementById("highScoreMessage");
const submitBtn = document.getElementById("submitMessage");


input_field.addEventListener("input", () => {
  const raw = input_field.value;
  
  if (!raw) {
    input_field.classList.remove("invalid");
    submitBtn.disabled = true;
    return;
  }

  if (raw.length > 50) {
    input_field.classList.add("invalid");
    submitBtn.disabled = true;
    return;
  }

  const cleaned = sanitizeMessage(raw);

  if (cleaned !== raw) {
    input_field.classList.add("invalid");
    submitBtn.disabled = true;
    //warning.textContent = "Only letters, numbers, and basic punctuation allowed.";
  } else {
    input_field.classList.remove("invalid");
    submitBtn.disabled = false;
    //warning.textContent = "";
  }
});


// PROFANITY FILTER - keep this updated in both places
const BANNED_WORDS = [
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "cunt",
  "pussy",
  "dick",
  "nigger",
  "nigga",
  "faggot",
  "fag",
  "retard",
];

  function sanitizeMessage(message) {

    let message1 = message
      .replace(/[<>]/g, "")
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .normalize("NFKC")
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g, "")
      .replace(/[^\p{L}\p{N} .,!?'"\-]/gu, "")
      .replace(/\s+/g, " ")
      .replace(/\b((https?:\/\/)|(www\.)|\w+\.\w{2,})[^\s]*\b/gi, "");

      BANNED_WORDS.forEach(word => {
        const wordRegex = new RegExp(`${word}`, "gi");
        message1 = message1.replace(wordRegex, "***")
      });

    return message1.slice(0, 50).trim();

  }
