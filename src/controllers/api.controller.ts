import { Controller, Post, Body, Res } from '@nestjs/common';
import { TavilySearchService } from 'src/services/tavily.service';
import { LLMCompilerGraph } from 'src/services/langgraph.service';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { SupabaseService } from 'src/services/supabase.service';

@Controller('api')
export class ApiController {
	
	constructor(private readonly graph: LLMCompilerGraph, private readonly supabase: SupabaseService) {}

	@Post('post-message')
	async postMessage(@Body() data: any, @Res() res: any): Promise<any> {
		const graph = await this.graph.setupGraph()
		const answer = await graph.invoke([new HumanMessage({content: data.message})])
		await this.supabase.uploadEmbeddings(answer)
		res.status(200).send({message: answer[answer.length - 1].content})
		return 
	}

	// @Post('web-search')
	// async webSearch(@Body() data: any, @Res() res: any): Promise<any> {
	// 	const search = await this.searchService.getTavilyAgent()
	// 	const results = await search.invoke({
	// 		input: data.message
	// 	})
	// 	res.status(200).send({results})
	// 	return
	// }

	// @Post('test-graph')
	// async testGraph(@Body() data: any, @Res() res: any): Promise<any> {
	// 	const graph = await this.graph.setupGraph()
	// 	const answer = await graph.invoke([new HumanMessage({content: data.message})])
	// 	console.log("Overall workflow")
	// 	console.log(answer)
	// 	await this.supabase.uploadEmbeddings(answer)
	// 	// const answer = await this.planAndExecute.executeGraph(app, data.message)
	// 	res.status(200).send(answer[answer.length - 1].content)
	// 	return
	// }

	// @Post('test-embeddings')
	// async testEmbeddings(@Body() data: any, @Res() res: any): Promise<any> {
	// 	// const embeddings = await this.supabase.uploadEmbeddings([new HumanMessage({content: data.message}), new SystemMessage({content: "Hello I am a system"})])
	// 	const answer = await this.supabase.searchEmbeddings("bruh")
	// 	res.status(200).send(answer)
	// 	return
	// }
}
