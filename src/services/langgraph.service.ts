import { Injectable } from '@nestjs/common';
import { AIMessage, BaseMessage } from '@langchain/core/messages';
import { planAndSchedule } from 'src/agents/taskFetchingAgent';
import { MessageGraph } from '@langchain/langgraph';
import { createJoinerAgent } from 'src/agents/joinerAgent';
import { CompiledStateGraph } from '@langchain/langgraph/dist/graph/state';

@Injectable()
export class LLMCompilerGraph {
  private graph: any

  async setupGraph() {
	  const joiner = await createJoinerAgent()

    const shouldContinue = (state: BaseMessage[]) => {
      // console.log(state)
      if (state[state.length - 1] instanceof AIMessage){
        return "__end__"
      }
      return "plan"
    }

    const graph = new MessageGraph()

    graph.addNode("plan", planAndSchedule)

    .addNode("join", joiner)

    .addEdge("__start__", "plan")

    .addEdge("plan", "join")

    .addConditionalEdges("join", shouldContinue)

    const app = graph.compile()
    return app
  }
}
