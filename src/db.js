import immutable from 'immutable';

import { pick, undefined_default } from './util.js';

function sqlite3_affinity(type_name) {
  type_name = type_name.toLowerCase();
  function type_name_contains(substring) {
    return type_name !== null && type_name.indexOf(substring) > -1;
  }
  if (type_name_contains('int')) {
    return 'integer';
  }
  if (['char', 'clob', 'text'].some(type_name_contains)) {
    return 'text';
  }
  if (type_name === null || type_name_contains('blob')) {
    return 'blob';
  }
  if (['real', 'floa', 'doub'].some(type_name_contains)) {
    return 'real';
  }
  return 'numeric';
}

// For when you need to build queries from table or column names on the fly:
function escape_identifier(identifier) {
  return ''.concat('"', identifier.replace(/"/, '""'), '"');
}

function row_summary(row, columns=undefined) {
  if (columns === undefined) {
    columns = Object.keys(row);
  }
  return columns.reduce(function (output, column, index) {
    return output.concat(
      (
        index === 0
        ? ''
        : '; '
      ),
      row[column]
    );
  }, '');
}

// Use e.g. with an insert column list, or a select where clause with `suffix`
// set to ' = ?'
function clause_with_columns(config) {
  const { row_data, separator = ', ', suffix = '' } = config;
  return Object.entries(row_data).reduce(function (result, entry, index) {
      const [ column_name, column_value ] = entry;
      result.sql_clause = result.sql_clause.concat(
        (
          index === 0
          ? ''
          : separator
        ),
        escape_identifier(column_name),
        suffix,
      );
      result.param_list.push(column_value);
      return result;
    },
    {
      sql_clause: '',
      param_list: [],
    },
  );
}

function db_utils(db) {
  const tables_query = db.prepare(`
    select name from pragma_table_list where name not like 'sqlite_%'
  `); // TODO: limit to `type='table'`?
  function table_choices() {
    return tables_query.pluck().all();
  }

  const columns_query = db.prepare(`
    select * from pragma_table_info(?) where pk != ?
  `);
  const exclude_pk_columns_query = db.prepare(`
    select * from pragma_table_info(?) where pk = 0
  `);
  function column_list(config) {
    let { table, exclude_rowid_pks, exclude_all_pks,
          include_only_pks } = config;
    exclude_rowid_pks = undefined_default(exclude_rowid_pks, false);
    exclude_all_pks = undefined_default(exclude_all_pks, false);
    include_only_pks = undefined_default(include_only_pks, false);

    const pk_columns = columns_query.all(table, 0);
    if (exclude_rowid_pks && pk_columns.length === 1) {
      // We could also check to be sure that this one row has pk === 1,
      // but by the SQLite specification it should.
      return columns_query.all(table, 1);
    }
    if (exclude_all_pks) {
      return exclude_pk_columns_query.all(table);
    }
    if (include_only_pks) {
      return pk_columns;
    }
    return columns_query.all(table, -1);
  }

  function column_choices(table) {
    return column_list({
      table,
      exclude_rowid_pks: true,
    }).map(function (column) {
      return {
        name: column.name,
        value: column.name,
      };
    });
  }

  const foreign_keys_query = db.prepare(`
    select * from pragma_foreign_key_list(?)
  `);
  function foreign_key_references(table) {
    return foreign_keys_query.all(table).reduce(function (list, row) {
      if (!list.has(row.id)) {
        const foreign_key_info = immutable.fromJS({
          from: [],
          to: {
            table: row.table,
            columns: []
          },
        });
        list = list.set(row.id, foreign_key_info)
      }
      list = list.setIn([row.id, 'from', row.seq], row.from);
      return list.setIn([row.id, 'to', 'columns', row.seq], row.to);
    }, immutable.List());
  }

  function sample_row(table, row, columns=undefined) {
    if (columns === undefined) {
      columns = column_list({
        table,
        include_only_pks: true,
      });
    }
    return columns.reduce(function (values, column) {
      values[column] = row[column.name];
      return values;
    }, {});
  }

  //function row_summary(table, row, column=undefined) {
   // const columns = column_list({
    //  table,
     // exclude_all_pks: true,
    //});
  //}

  function filtered_rows(config) {
    let { table, restricting_values } = config;
    restricting_values = undefined_default(restricting_values, {});
    console.log('restricting_values:', restricting_values);

    let { sql_clause: where_clause, param_list } = clause_with_columns({
      row_data: restricting_values,
      separator: ' and ',
      suffix: ' = ?',
    });
    if (param_list.length > 0) {
      where_clause = ' where '.concat(where_clause);
    }

    console.log(where_clause, param_list);
    return db.prepare(''.concat(
      'select *',
      /*value_columns.reduce(function (output, column, index) {
        return ''.concat(
          (
            index === 0
            ? ''
            : ', '
          ),
          escape_identifier(column),
        );
      }, ''),*/
      ' from ',
      escape_identifier(table),
      where_clause,
    )).all(param_list);
  }

  function row_choices(config) {
    let { table, value_columns, restricting_values,
          display_columns } = config;

    const rows = filtered_rows(config);
    if (rows.length === 0) {
      return [
        {
          name: 'No choices available!',
          value: undefined,
        },
      ];
    }
    return rows.map(function (row) {
      if (value_columns === undefined) {
        value_columns = column_list({
          table,
          include_only_pks: true,
        }).map(function (column) {
          return column.name;
        });
      }
      /*console.log('row:', row);
      console.log('value_columns:', value_columns);
      console.log('pick:', pick(row, value_columns));*/
      const choice_name = row_summary(row, display_columns);
      return {
        name: choice_name,
        short: choice_name,
        value: pick(row, value_columns),
      };
    });
  }

  function insert(table, row_data) {
    const { sql_clause: columns_clause, param_list } = clause_with_columns({
      row_data
    });
    console.log(row_data);

    return db.prepare(''.concat(
      'insert into ',
      escape_identifier(table),
      ' (',
      columns_clause,
      ') values (',
      Array(param_list.length).fill('?').join(', '),
      ')',
    )).run(param_list);
  }

  function update(table, key, row_data) {
    console.log('update:', key, row_data);
    const { sql_clause: set_clause,
            param_list: set_params } = clause_with_columns({
      row_data,
      suffix: ' = ?',
    });
    const { sql_clause: where_clause,
            param_list: where_params } = clause_with_columns({
      row_data: key,
      separator: ' and ',
      suffix: ' = ?',
    });

    return db.prepare(''.concat(
      'update ',
      escape_identifier(table),
      ' set ',
      set_clause,
      ' where ',
      where_clause,
    )).run(set_params.concat(where_params));
  }

  return Object.freeze({
    table_choices,
    column_list,
    column_choices,
    foreign_key_references,
    filtered_rows,
    row_choices,
    insert,
    update,
  });
}

export { sqlite3_affinity, db_utils };
