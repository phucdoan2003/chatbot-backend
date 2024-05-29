const { parentPort } = require('worker_threads');

parentPort.on('message', async (message) => {
    const {func , task, observations, resolve, reject } = message;
    console.log(message)
    try {
        await processTask(func, task, observations);
        parentPort.postMessage({ resolve: true, taskIdx: task.idx });
    } catch (error) {
        parentPort.postMessage({ reject: true, taskIdx: task.idx, error: error.message });
    }
});

async function processTask(func, task, observations) {
    console.log(`Processing task ${task.idx}...`);
    
    // Simulate task processing delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Here you would implement the actual task logic
    func(task, observations)
}