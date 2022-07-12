# sinq

Sinq aims to provide a nimble command-line data-entry tool for [SQLite](https://sqlite.org/index.html); it currently uses the [Inquirer](https://github.com/SBoudrias/Inquirer.js) library for displaying prompts.  The name is pronounced like "sink", and stands for "SQLite Inquiry (with Inquirer)".

## Installation and use

If you already have a basic `node` environment setup that includes `yarn`, you should be able to clone this repository and then use `yarn install` to install the dependencies.

From within the cloned directory, you can run `yarn sinq <SQLite database file>` to begin editing the selected database file with Sinq.  Hopefully the prompts are fairly self-explanatory (if you speak English), but see the TODOs below for more on that.

Sinq does not provide an interface to modifying the table structure (schema) in a database; I currently believe that using SQL in the SQLite shell is reasonably adequate for that.  Sinq aims to provide a way to quickly add or modify information in existing tables.

As a simple example, we can play with an SQLite database for a TODO list.  Creating the database might look like:

```
sqlite3 todo.db \
'create table task (id integer primary key, name text, '\
'                   due datetime, completed datetime)'
```

You could then use Sink with this database:

[![asciicast](https://asciinema.org/a/508113.svg)](https://asciinema.org/a/508113)

To run the test suite, run `yarn test`.

## TODO and contributing

- [ ] Better-flowing menu interactions
- [ ] Keyboard shortcuts (e.g. for skipping around in the prompts for a row)
- [ ] More robust command-line argument handling
- [ ] Build and installation support
- [ ] Following up with maintainer of [`inquirer-search-list`](https://github.com/robin-rpr/inquirer-search-list) to explore the status of the maintenance of that plugin
  - [ ] [This plugin seems to need maintainers and general maintenance.](https://github.com/robin-rpr/inquirer-search-list/issues/8)
  - [ ] The `short` feature is particularly important to Sinq, but is [broken in this plugin](https://github.com/robin-rpr/inquirer-search-list/issues/3).
- [ ] Additional code documentation, in particular:
  - [ ] The `rekey` function
  - [ ] The `input_parse` function
- [ ] Make the open in an editor feature work
- [ ] Add a user configuration system
- [ ] Localization
- [ ] Incorporate a date and time user interface
