/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SiteConfigResource, StringDictionary, User } from 'azure-arm-website/lib/models';
import * as portfinder from 'portfinder';
import * as vscode from 'vscode';
import { SiteClient } from 'vscode-azureappservice';
import { AzureTreeDataProvider, IAzureNode } from 'vscode-azureextensionui';
import { DebugProxy } from '../diagnostics/DebugProxy';
import { SiteTreeItem } from '../explorer/SiteTreeItem';
import { WebAppTreeItem } from '../explorer/WebAppTreeItem';

const HTTP_PLATFORM_DEBUG_PORT: string = '8898';
const JAVA_OPTS: string = `-Djava.net.preferIPv4Stack=true -Xdebug -Xrunjdwp:transport=dt_socket,server=y,suspend=n,address=127.0.0.1:${HTTP_PLATFORM_DEBUG_PORT}`;

export async function startRemoteDebug(tree: AzureTreeDataProvider, node: IAzureNode<SiteTreeItem>, outputChannel: vscode.OutputChannel): Promise<void> {
    if (!node) {
        node = <IAzureNode<WebAppTreeItem>>await tree.showNodePicker(WebAppTreeItem.contextValue);
    }

    const client: SiteClient = node.treeItem.client;
    const portNumber: number = await portfinder.getPortPromise();
    const publishCredential: User = await client.getWebAppPublishCredential();

    const debugProxy: DebugProxy = new DebugProxy(outputChannel, client, portNumber, publishCredential);

    debugProxy.on('error', (err: Error) => {
        debugProxy.dispose();
        throw err;
    });

    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window }, async (p: vscode.Progress<{}>) => {
        // tslint:disable-next-line:no-any
        return new Promise(async (resolve: () => void, reject: (e: any) => void): Promise<void> => {
            try {
                //const siteConfig: SiteConfigResource = await client.getSiteConfig();
                //const appSettings: StringDictionary = await client.listApplicationSettings();
                // if (needUpdateSiteConfig(siteConfig) || (appSettings.properties && needUpdateAppSettings(appSettings.properties))) {
                //     const confirmMsg: string = 'The configurations of the selected app will be changed before debugging. Would you like to continue?';
                //     const result: vscode.MessageItem = await vscode.window.showWarningMessage(confirmMsg, DialogResponses.yes, DialogResponses.learnMore, DialogResponses.cancel);
                //     if (result === DialogResponses.learnMore) {
                //         // tslint:disable-next-line:no-unsafe-any
                //         opn('https://aka.ms/azfunc-remotedebug');
                //         return;
                //     } else {
                //         await updateSiteConfig(outputChannel, client, p, siteConfig);
                //         await updateAppSettings(outputChannel, client, p, appSettings);
                //     }
                // }

                p.report({ message: 'starting debug proxy...' });
                outputChannel.appendLine('starting debug proxy...');
                // tslint:disable-next-line:no-floating-promises
                debugProxy.startProxy();
                debugProxy.on('start', resolve);
            } catch (error) {
                reject(error);
            }
        });
    });

    const sessionId: string = Date.now().toString();

    await vscode.debug.startDebugging(undefined, {
        name: sessionId,
        type: 'node',
        protocol: "inspector",
        request: 'attach',
        address: 'localhost',
        port: portNumber
    });

    const terminateDebugListener: vscode.Disposable = vscode.debug.onDidTerminateDebugSession((event: vscode.DebugSession) => {
        if (event.name === sessionId) {
            if (debugProxy !== undefined) {
                debugProxy.dispose();
            }
            terminateDebugListener.dispose();
        }
    });

}

async function updateSiteConfig(outputChannel: vscode.OutputChannel, client: SiteClient, p: vscode.Progress<{}>, siteConfig: SiteConfigResource): Promise<void> {
    p.report({ message: 'Fetching site configuration...' });
    outputChannel.appendLine('Fetching site configuration...');
    if (needUpdateSiteConfig(siteConfig)) {
        siteConfig.use32BitWorkerProcess = false;
        siteConfig.webSocketsEnabled = true;
        p.report({ message: 'Updating site configuration to enable remote debugging...' });
        outputChannel.appendLine('Updating site configuration to enable remote debugging...');
        await client.updateConfiguration(siteConfig);
        p.report({ message: 'Updating site configuration done...' });
        outputChannel.appendLine('Updating site configuration done...');
    }
}

async function updateAppSettings(outputChannel: vscode.OutputChannel, client: SiteClient, p: vscode.Progress<{}>, appSettings: StringDictionary): Promise<void> {
    p.report({ message: 'Fetching application settings...' });
    outputChannel.appendLine('Fetching application settings...');
    if (appSettings.properties && needUpdateAppSettings(appSettings.properties)) {
        appSettings.properties.JAVA_OPTS = JAVA_OPTS;
        appSettings.properties.HTTP_PLATFORM_DEBUG_PORT = HTTP_PLATFORM_DEBUG_PORT;
        p.report({ message: 'Updating application settings to enable remote debugging...' });
        outputChannel.appendLine('Updating application settings to enable remote debugging...');
        await client.updateApplicationSettings(appSettings);
        p.report({ message: 'Updating application settings done...' });
        outputChannel.appendLine('Updating application settings done...');
    }
}

function needUpdateSiteConfig(siteConfig: SiteConfigResource): boolean {
    return siteConfig.use32BitWorkerProcess || !siteConfig.webSocketsEnabled;
}

function needUpdateAppSettings(properties: {}): boolean | undefined {
    // tslint:disable-next-line:no-string-literal
    return properties['JAVA_OPTS'] !== JAVA_OPTS || properties['HTTP_PLATFORM_DEBUG_PORT'] !== HTTP_PLATFORM_DEBUG_PORT;
}
