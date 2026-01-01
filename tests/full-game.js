const { GameTest } = require('../test-framework');

class FullGameTest extends GameTest {
  constructor() {
    super('Full Game Completion', 3006);
    this.timeout = 180000;
  }

  async execute() {
    await new Promise(resolve => {
      this.client.onReady = () => {
        this.pass(`Connected as player ${this.client.playerId}`);
        resolve();
      };
    });

    for (let stage = 1; stage <= 4; stage++) {
      this.log(`[Stage ${stage}] Starting climb...`);
      await this.client.testClimbing(80000);

      const goalReached = await new Promise(resolve => {
        const checkInterval = setInterval(() => {
          if (this.client.stagesCompleted.includes(stage)) {
            clearInterval(checkInterval);
            resolve(true);
          }
        }, 100);
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve(false);
        }, 90000);
      });

      if (goalReached) {
        this.pass(`Stage ${stage} goal reached`);
        if (stage < 4) {
          this.client.nextStage();
          await new Promise(r => setTimeout(r, 2000));
        }
      } else {
        this.fail(`Stage ${stage} goal not reached`);
        return;
      }
    }

    this.pass('All stages completed!');
    this.clearTimeout();
  }
}

const test = new FullGameTest();
test.run();
