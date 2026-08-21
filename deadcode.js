  // get date for database key
  function getDailyKey() {
    const today = new Date();
    return today.toISOString().split("T")[0]; // e.g. "2025-02-15"
  }


// get current high score
  async function loadTodayHighscore() {
      const day = getDailyKey();
      //const scoreRef = ref(database, "dailyHighscores/" + day);
      const snapshot = await get(scoreRef);
  
      if (snapshot.exists()) {
          return snapshot.val(); // {score: 123, message: "..."}
      } else {
          return { score: 0, message: "-" }; // default if none exists
      }
  }
  
  async function updateHighScoreUI() {
      const high = await loadTodayHighscore();
  
      const score = high.score ?? 0;
      const message = high.message ?? "-";
  
      const scoreElem = document.getElementById("currentHighScore");
      scoreElem.textContent = `${score.toFixed(1)}`;
  
      const messageElem = document.getElementById("currentMessage");
      messageElem.textContent = `"${message}"`;
  }
  
  
  
  // compare score to high score
  // NO LONGER IN USE
  async function submitScore(new_score, message) {
    //const day = getDailyKey();
    //const scoreRef = ref(database, "dailyHighscores/" + day);

    //const snapshot = await get(scoreRef);

    runTransaction(scoreRef, (currentData) => {
      if (currentData === null || Number(new_score.toFixed(1)) > Number(currentData.score ?? 0)) {
        return {
            score: Number(new_score.toFixed(1)),
            message: String(message),
            timestamp: Date.now()
        };
      } else {
        return currentData; // no change
      }
    });

    /* if (!snapshot.exists() || Number(new_score.toFixed(1)) > Number(snapshot.val().score ?? 0)) {
        // new high score!
        // TODO delete this part we dont wanna set the score here

        //const prompt_message = prompt("New high score message?");
        await set(scoreRef, {
            score: new_score.toFixed(1),
            message: String("High score!"),
            timestamp: Date.now()
            //score: typeof new_score === "number" ? new_score : 0, // number only
            //message: typeof "hish score!" === "string" ? "hish score!" : "", // string only
            //timestamp: Date.now() // number
        });

        return true;  // isNewHighScore
    } */

    return false; // not a high score
}





/* function showHighScorePrompt(onSubmit) {
  const modal = document.getElementById("highScoreModal");
  const input = document.getElementById("highScoreMessage");

  modal.classList.remove("hidden");
  input.value = "";
  input.focus();

  document.getElementById("submitMessage").onclick = () => {
    modal.classList.add("hidden");
    onSubmit(input.value.trim());
  };

  document.getElementById("skipMessage").onclick = () => {
    modal.classList.add("hidden");
    onSubmit(""); // empty message
  };
} */








// TODO delete this we dont wanna take the message before we determine if its a high score
// NOT IN USE
function gameOver() {
    const score = playerScore;

    const message = prompt("New high score message?");
    
    submitScore(score, message).then(isHigh => {
        if (isHigh) {
            alert("NEW DAILY HIGH SCORE!");
        } else {
            alert("Score submitted. Not today’s high.");
        }
    });
}


 /*  // Function to get the selected difficulty value
  function getSelectedDifficulty() {
    for (const radio of difficultyRadios) {
      if (radio.checked) {
        return radio.value;
      }
    }
    return null; // No color selected
  }

  // Add an event listener to each radio button to detect changes
  difficultyRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      const selectedDiff = getSelectedDifficulty();
      if (selectedDiff === "easy") {
        total_velocity = 100;
      } else if (selectedDiff === "hard") {
        total_velocity = 300;
      } else {
        total_velocity = 200;
      }
    });
  }); */


// generate new enemies if there are less than the max
   /*while (num_enemies < max_enemies) {
        const enemy = this.add.circle(Phaser.Math.Between(0, 550), Phaser.Math.Between(0, 450), 10, 0x888888);
        this.physics.add.existing(enemy);
        enemies.add(enemy);
        enemy.body.setVelocity(150, -150);
        num_enemies += 1;
    }*/