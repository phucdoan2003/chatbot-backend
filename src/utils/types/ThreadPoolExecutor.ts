import { Worker } from 'worker_threads';

class ThreadPoolExecutor {
    private workers: Worker[];
    private taskQueue: any[];
    private results: any[];
    private workerAvailability: boolean[];

    constructor(workerFile: string, numThreads: number) {
        this.workers = [];
        this.taskQueue = [];
        this.results = [];
        this.workerAvailability = new Array(numThreads).fill(true);

        for (let i = 0; i < numThreads; i++) {
            const worker = new Worker(workerFile);
            worker.on('message', (result) => {
                this.results.push(result);
                this.workerAvailability[i] = true;
                this.runNextTask();
            });
            this.workers.push(worker);
        }
    }

    private runNextTask() {
        for (let i = 0; i < this.workers.length; i++) {
            if (this.workerAvailability[i] && this.taskQueue.length > 0) {
                const task = this.taskQueue.shift();
                this.workerAvailability[i] = false;
                this.workers[i].postMessage(task);
            }
        }
    }

    submit(task: any) {
        this.taskQueue.push(task);
        this.runNextTask();
    }

    getResults() {
        return this.results;
    }
}

export default ThreadPoolExecutor;