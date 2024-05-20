import { Controller, Post, Body, Res } from '@nestjs/common';
import { TavilySearchService } from 'src/services/tavily.service';
import { PlanAndExecuteGraph } from 'src/services/langgraph.service';
import { formatToOpenAIFunctionMessages } from 'langchain/agents/format_scratchpad';
import { AgentStep } from 'langchain/agents';

@Controller('api')
export class ApiController {
	constructor(private readonly searchService: TavilySearchService, private readonly planAndExecute: PlanAndExecuteGraph) {}

	@Post('post-message')
	async postMessage(@Body() data: any, @Res() res: any): Promise<any> {
		// const answer = (await this.openAIService.defaultChat(data.message)).content.toString();
		res.status(200).send({});
		return 
	}

	@Post('web-search')
	async webSearch(@Body() data: any, @Res() res: any): Promise<any> {
		// const search = await this.searchService.getRunnableTavily()
		// const results = await search.invoke({
		// 	input: data.message
		// })
		// res.status(200).send({results})
		return
	}

	@Post('test')
	async test(@Body() data: any, @Res() res: any): Promise<any> {
		const app = await this.planAndExecute.setupGraph()
		const answer = await this.planAndExecute.executeGraph(app, data.message)
		res.status(200).send({answer: answer.response})
		return
	}
}
