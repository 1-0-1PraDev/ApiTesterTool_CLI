#!/usr/bin/env node
import { program } from 'commander';
import fs from 'fs';
import chalk from 'chalk';
import axios from 'axios';
import { expect } from 'chai';
import figlet from 'figlet';
import jsonpath from 'jsonpath';
import Ajv from 'ajv';

const ajv = new Ajv();

const sendRequestWithRetries = async(retries = 3, delay = 1000, config) => {
    let attempt = 0;
    const startTime = Date.now();

    while(attempt < retries){
        try{
            const response = await axios(config);
            const endTime = Date.now();
            const duration = endTime - startTime;

            console.log(chalk.bgGreenBright.white(`Status code: ${response?.status}`));
            console.log(chalk.bgBlue.white(`Response Time Taken: ${duration}`));
            console.log(chalk.magentaBright(`${chalk.bgCyanBright.black('Response:')} ${JSON.stringify(response.data)}`));
            
            return response;
        }catch(err){    
            const endTime = Date.now();
            const duration = endTime - startTime;
            attempt++;
            console.log(chalk.red(`Attempt failed!, Retrying in ${delay}ms...`));

            if(attempt >= retries){
                console.log(chalk.red(`All ${retries} attempts failed: ${err.message}`));
                console.log(chalk.blue(`Time until error: ${duration} ms`));
                throw err;
            }

            // Delay before retrying
            await new Promise(resolve => setTimeout(resolve, delay));

            // Double the delay - Exponential Backoff
            delay *= 2;
        }
    }
}

console.log(chalk.cyanBright(figlet.textSync('Api Tester Tool', { horizontalLayout: 'full' })));

program
    .command('request')
    .showHelpAfterError() // Show help after an error
    .showSuggestionAfterError() // Show suggestions after a command is not found
    .description('Send an API Request')
    .requiredOption('-u, --url <URL>', 'API URL')
    .requiredOption('-m, --method <method>', 'HTTP method (GET, POST, PUT, DELETE)')
    .option('-h, --headers <headers>', 'Headers in the JSON format', '{}')
    .option('-d, --data <data>', 'Data for POST/PUT in JSON format', '{}')
    .option('-a, --auth <auth>', 'Authorization method (apiKey, oauth)')
    .option('-v, --validate-schema <schema>', 'Validate response with JSON format')
    .option('-r, --retries <number>', 'Number of retries on failure', parseInt)
    .option('--assert-status <code>', 'Assert that the response status code matches')
    .option('--assert-header <header>', 'Assert that a response header matches (format: "HeaderName: value")')
    // .option('--assert-body <jsonPath>=<value>', 'Assert that a value in the response body matches')
    .action(async (options) => {
        try{
            const config = {
                method: options.method,
                url: options.url,
            }

            // Add headers if provided
            if(options.headers){
                config.headers = JSON.parse(options.headers);
            }

            // Add body data for POST/PUT Request
            if(options.data){
                config.data = JSON.parse(options.data);
            }

            // Add authentication if provied
            // if(options.auth){
            //     config.headers = {
            //         ...config.headers,
            //         Authorization: `Bearer ${options.token}`
            //     }
            // }

            // Handle authentication
            switch(options.auth){
                case 'basic':
                    if(options.username && options.password){
                        const credentials = Buffer.from(`${options.username}:${options.password}`);
                        config.headers['Authorization'] = `Basic ${credentials}`;
                    }else{
                        console.log(chalk.red('Username and Password are required for basic authentication'));
                        return;
                    }
                    break;

                case 'bearer':
                    if(options.token){
                        config.headers['Authorization'] = `Bearer ${options.token}`;
                        console.log(chalk.red('Token is required for Bearer token authentication'));
                        return;
                    }
                    break;

                default:
                    break;
            }

            const response = await sendRequestWithRetries(options.retries || 1, 1000, config);
      

            if(options.validateSchema){
                const schema = JSON.parse(fs.readFileSync(options.validateSchema));
                const isValid = validateReponse(schema, response.data);
                if(isValid){
                    console.log(chalk.green(`Response is according to the schema`));
                }else{
                    console.error(chalk.red('Response validation failed.'));
                }
            }

              // Call assertions on the response
              assertResponse(response, options);

        }catch(err){
            console.error(chalk.red(`Error ${err.message}`));
            }
    });

    // Show help if no command is provided
if (!process.argv.slice(2).length) {
    program.help(); // Display help if no arguments are passed
}

program.parse(process.argv);


const validateReponse = (schema, response) => {
    const validate = ajv.compile(schema);
    const valid = validate(response);

    if(!valid){
        console.log(chalk.red(`Erros: ${JSON.stringify(validate.errors)}`));
    }

    return valid;
}


const assertResponse = (response, options) => {
    let assertionsPassed = true;

    // Assert status code
    if(options.assertStatus){
        if(response.statusCode !== parseInt(options.assertStatus)){
            console.error(chalk.red(`${chalk.bgRed.white('Assertion Failed:')} Expected status ${options.assertStatus}, got ${response.status}`));
            assertionsPassed = false;
        }else{
            console.log(chalk.green(`${chalk.bgMagentaBright.white('Assertion Passed:')} Status code is ${response.status}`));
        }
    }

    // Assert Header
    if(options.assertHeader){
        const [headerName, expectedValue] = options.assertHeader.split(';').map((item) => item.trim());
        const actualValue = response.headers[headerName.toLowerCase()];

        if(actualValue !== expectedValue){
            console.error(chalk.red(`${chalk.bgRed.white('Assertion Failed:')} Expected header ${headerName}: ${expectedValue}, got ${actualValue}`));
            assertionsPassed = false;
        }else {
            console.log(chalk.green(`${chalk.bgMagentaBright.white('Assertion Passed:')} Header ${headerName} matches`));
        }
    }

    // Assert Body 
    if(options.assertBody){
        if(!checkAssertionBody(response)) {
            console.error(chalk.red(`Body Assertion Failed`));
            assertionsPassed = false;
        }else {
            console.log(chalk.green(`Body Assertion Passed`));
        }
    }

    return assertionsPassed;
}

// for expected-values.json like
/*
{
  "expectedName": "John Doe",
  "expectedCity": "New York",
  "expectedOrderAmounts": [250, 150]
}
*/

const checkAssertionBody = (response) => {
    const expectedValues = JSON.parse(fs.readFileSync('expected-values.json', 'utf-8'));
    const data = response.data;

    // Extract values using jsonpath
    const userName = jsonpath.query(data, '$.user.name')[0];
    const city = jsonpath.query(data, '$.user.address.city')[0];
    const orderAmounts = jsonpath.query(data, '$.user.orders[*].amount');

    // Perform assertion usin chai expect
    expect(userName).to.equal(expectedValues.expectedName);
    expect(city).to.equal(expectedValues.expectedCity);
    expect(orderAmounts).to.include.members(expectedValues.expectedOrderAmounts);

    return true;
}

