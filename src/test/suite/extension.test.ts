import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('harungecit.smart-changelists'));
    });

    test('Extension package.json should be valid', () => {
        const extension = vscode.extensions.getExtension('harungecit.smart-changelists');
        assert.ok(extension);

        const packageJSON = extension.packageJSON;
        assert.strictEqual(packageJSON.name, 'smart-changelists');
        assert.strictEqual(packageJSON.publisher, 'harungecit');
        assert.ok(packageJSON.version);
    });

    test('View container should be defined in package.json', () => {
        const extension = vscode.extensions.getExtension('harungecit.smart-changelists');
        assert.ok(extension);

        const packageJSON = extension.packageJSON;
        assert.ok(packageJSON.contributes.viewsContainers.activitybar);
        assert.ok(packageJSON.contributes.views.smartChangelists);
    });

    test('Commands should be defined in package.json', () => {
        const extension = vscode.extensions.getExtension('harungecit.smart-changelists');
        assert.ok(extension);

        const packageJSON = extension.packageJSON;
        const commands = packageJSON.contributes.commands;

        const expectedCommands = [
            'smartChangelists.createChangelist',
            'smartChangelists.deleteChangelist',
            'smartChangelists.renameChangelist',
            'smartChangelists.shelveFile',
            'smartChangelists.unshelveFile',
            'smartChangelists.refreshAll'
        ];

        const commandIds = commands.map((cmd: { command: string }) => cmd.command);

        for (const cmd of expectedCommands) {
            assert.ok(
                commandIds.includes(cmd),
                `Command ${cmd} should be defined in package.json`
            );
        }
    });

    test('Configuration should be defined in package.json', () => {
        const extension = vscode.extensions.getExtension('harungecit.smart-changelists');
        assert.ok(extension);

        const packageJSON = extension.packageJSON;
        const properties = packageJSON.contributes.configuration.properties;

        assert.ok(properties['smartChangelists.showEmptyChangelists']);
        assert.ok(properties['smartChangelists.autoRefreshOnSave']);
        assert.ok(properties['smartChangelists.confirmBeforeCommit']);
        assert.ok(properties['smartChangelists.confirmBeforeRevert']);
        assert.ok(properties['smartChangelists.saveSnapshotsToFile']);
        assert.ok(properties['smartChangelists.enableVersionComparison']);
    });
});

suite('Configuration Test Suite', () => {
    test('Configuration should have default values', () => {
        const config = vscode.workspace.getConfiguration('smartChangelists');

        // Test default configuration values
        assert.strictEqual(config.get('showEmptyChangelists'), true);
        assert.strictEqual(config.get('autoRefreshOnSave'), true);
        assert.strictEqual(config.get('confirmBeforeCommit'), true);
        assert.strictEqual(config.get('confirmBeforeRevert'), true);
        assert.strictEqual(config.get('saveSnapshotsToFile'), false);
        assert.strictEqual(config.get('enableVersionComparison'), false);
    });
});
