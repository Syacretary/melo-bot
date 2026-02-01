const fs = require('fs-extra');
const path = require('path');
const pino = require('pino');

const logger = pino({
    level: 'info',
    transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' }
    }
});

class ToolHandler {
    constructor() {
        this.toolsPath = path.join(__dirname, '../tools');
        this.schemasPath = path.join(__dirname, '../tools/schemas');
        this.registry = new Map();
        this._initRegistry();
    }

    _initRegistry() {
        if (!fs.existsSync(this.schemasPath)) return;

        const schemas = fs.readdirSync(this.schemasPath).filter(f => f.endsWith('.json'));
        
        for (const schemaFile of schemas) {
            const toolName = path.basename(schemaFile, '.json');
            const implFile = path.join(this.toolsPath, `${toolName}.js`);

            if (fs.existsSync(implFile)) {
                this.registry.set(toolName, {
                    schemaPath: path.join(this.schemasPath, schemaFile),
                    implPath: implFile
                });
            } else {
                logger.warn(`Tool schema found for "${toolName}" but implementation file is missing.`);
            }
        }
    }

    getTools() {
        const tools = [];
        for (const [name, paths] of this.registry) {
            try {
                const schema = fs.readJSONSync(paths.schemaPath);
                schema.name = name; 
                tools.push(schema);
            } catch (err) {
                logger.error(`Error reading schema for ${name}: ${err.message}`);
            }
        }
        return [{ function_declarations: tools }];
    }

    /**
     * Get tools in OpenAI/Groq format
     */
    getOpenAITools() {
        const tools = [];
        for (const [name, paths] of this.registry) {
            try {
                const schema = fs.readJSONSync(paths.schemaPath);
                
                // Convert Gemini-style schema to OpenAI-style
                const convertSchema = (obj) => {
                    if (typeof obj !== 'object' || obj === null) return obj;
                    
                    const newObj = Array.isArray(obj) ? [] : {};
                    for (const key in obj) {
                        if (key === 'type' && typeof obj[key] === 'string') {
                            // Map Gemini types to JSON Schema types
                            const typeMap = {
                                'STRING': 'string',
                                'NUMBER': 'number',
                                'INTEGER': 'integer',
                                'BOOLEAN': 'boolean',
                                'ARRAY': 'array',
                                'OBJECT': 'object'
                            };
                            newObj[key] = typeMap[obj[key]] || obj[key].toLowerCase();
                        } else {
                            newObj[key] = convertSchema(obj[key]);
                        }
                    }
                    return newObj;
                };

                const openAISchema = {
                    type: "function",
                    function: {
                        name: name,
                        description: schema.description,
                        parameters: convertSchema(schema.parameters)
                    }
                };
                tools.push(openAISchema);
            } catch (err) {
                logger.error(`Error formatting OpenAI schema for ${name}: ${err.message}`);
            }
        }
        return tools.length > 0 ? tools : undefined;
    }

    async executeTool(name, args, context = {}) {
        if (!this.registry.has(name)) {
            logger.error(`Execution failed: Tool "${name}" not found in registry.`);
            throw new Error(`Tool ${name} not found`);
        }

        const { implPath } = this.registry.get(name);
        
        try {
            logger.info({ event: 'TOOL_EXEC_START', tool: name, args });
            
            const toolModule = require(implPath);
            if (typeof toolModule.execute !== 'function') {
                throw new Error(`Tool ${name} does not export an 'execute' function.`);
            }

            const result = await toolModule.execute(args, context);
            
            logger.info({ 
                event: 'TOOL_EXEC_END', 
                tool: name, 
                success: !!(result && !result.error),
                output: typeof result === 'object' ? JSON.stringify(result).slice(0, 500) : result 
            });

            return result;
        } catch (error) {
            logger.error({ event: 'TOOL_EXEC_ERROR', tool: name, error: error.message });
            return { error: error.message };
        }
    }
}

const toolHandler = new ToolHandler();
module.exports = toolHandler;