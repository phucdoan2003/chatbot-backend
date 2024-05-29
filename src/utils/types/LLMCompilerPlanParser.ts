import { BaseTransformOutputParser, FormatInstructionsOptions, OutputParserException } from "@langchain/core/output_parsers";
import { BaseMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { Tool } from "@langchain/core/tools";
import { Task } from "./PlanAndSchedule";
import { zodToJsonSchema } from "zod-to-json-schema"
import { z } from "zod"


const THOUGHT_PATTERN = /Thought: ([^\n]*)/;
const ACTION_PATTERN = /\n*(\d+)\. (\w+)\((.*)\)(\s*#\w+\n)?/;
const ID_PATTERN = /\$\{?(\d+)\}?/g;
const END_OF_PLAN = "<END_OF_PLAN>";



function parseLLMCompilerActionArgs(args: string, tool: string | Tool): {[key: string] : any} {
    // console.log("parsing args")
    // console.log(args)
    if (!args) {
        return [];
    }

    if (typeof tool == "string"){
        return []
    }

    let extractedArgs: { 
        [key: string]: any
    } = {};
    let toolKey: string | null = null;
    let prevIdx: number | null = null;

    const schema = Object.keys(tool.schema._def.schema.shape)

    // console.log(schema)
    for (const key of schema) {
        if (args.includes(`${key}=`)) {
            const idx = args.indexOf(`${key}=`);
            if (prevIdx !== null) {
                extractedArgs[toolKey] = args.substring(prevIdx, idx).trim().replace(/,+$/, "").replace(/"/g, "");
            }
            args = args.split(`${key}=`, 2)[1];
            toolKey = key
            prevIdx = 0;
        }
    }

    if (prevIdx !== null) {
        extractedArgs[toolKey] = args.substring(prevIdx).trim().replace(/,$/, "").replace(/\)$/, "").replace(/"/g, "");
        // console.log(extractedArgs[toolKey])
    }
    
    // console.log(extractedArgs)
    return extractedArgs;
}

function defaultDependencyRule(idx: number, args: string): boolean {
    const matches = Array.from(args.matchAll(ID_PATTERN));
    const numbers = matches.map(match => parseInt(match[1]));
    return numbers.includes(idx);
}

function getDependenciesFromGraph(idx: number, toolName: string, args: {[key: string]: any}): {[key: string]: any} {
    if (toolName === "join") {
        return Array.from({ length: idx - 1 }, (_, i) => (i + 1).toString());
    }
    return Array.from({ length: idx - 1 }, (_, i) => i + 1)
        .filter(i => defaultDependencyRule(i, JSON.stringify(args)))
        .map(String);
}


function instantiateTask(tools: Tool[],idx: number, toolName: string, args:any | string, thought?: string): Task {
    let tool: Tool | string;
    if (toolName == "join") {
        tool = "join";
    } else {
        tool = tools[tools.map(tool => tool.name).indexOf(toolName)] || (() => { throw new OutputParserException(`Tool ${toolName} not found`); })();
    }
    const toolArgs = parseLLMCompilerActionArgs(args, tool);
    const dependencies = getDependenciesFromGraph(idx, toolName, toolArgs);

    return {
        idx: idx,
        tool: tool,
        args: toolArgs,
        dependencies: dependencies,
        thought: thought
    };
}

export class LLMCompilerPlanParser extends BaseTransformOutputParser<Task[]> {
    getFormatInstructions(options?: FormatInstructionsOptions): string {
        throw new Error("Method not implemented.");
    }
    lc_namespace: string[] = [];

    tools: Tool[];

    constructor(tools: Tool[]) {
        super();
        this.tools = tools;
    }
    
    async *_transform(input: AsyncGenerator<string | BaseMessage>): AsyncGenerator<Task[]> {
        let texts: string[] = [];
        let thought: string | undefined;
                
        for await (const chunk of input) {
            const text = typeof chunk === 'string' ? chunk : chunk.content;
            for (const [task, updatedThought] of this.ingestToken(text.toString(), texts, thought)) {
                thought = updatedThought;
                yield [task];
            }
        }

        if (texts.length) {
            const [task, _] = this.parseTask(texts.join(""), thought);
            if (task) {
                yield [task];
            }
        }
    }


    async parse(text: string): Promise<Task[]> {
        const input = async function*() { yield text; }();
        let tasks: Task[] = [];
        for await (const task of this._transform(input)) {
          tasks.push(task[0]);
        }
        return tasks;
      }

      async * stream(input: string | BaseMessage, options: RunnableConfig | null = null, ...kwargs: any): any {
        const inputGenerator = async function*() { yield input; }();
        yield* this._transform(inputGenerator);
      }

    private *ingestToken(token: string, buffer: string[], thought: string | undefined): IterableIterator<[Task, string]> {
        buffer.push(token);
        if (token.includes("\n")) {
            const buffer_ = buffer.join("").split("\n");
            const suffix = buffer_.pop()!;
            for (const line of buffer_) {
                const [task, updatedThought] = this.parseTask(line, thought);
                if (task) {
                    yield [task, updatedThought];
                }
            }
            buffer.length = 0;
            buffer.push(suffix);
        }
    }

    private parseTask(line: string, thought: string | undefined): [Task | null, string | undefined] {
        let task: Task | null = null;
        let match: RegExpMatchArray | null;
        if (match = line.match(THOUGHT_PATTERN)) {
          thought = match[1];
        } else if (match = line.match(ACTION_PATTERN)) {
          const [_, idxStr, toolName, args] = match;
          const idx = parseInt(idxStr);
          task = instantiateTask(this.tools, idx, toolName, args, thought);
          thought = undefined;
        }
        
        return [task, thought];
      }
}