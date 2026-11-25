# sqlnotebook README

一个mssql 工具

## 打包

``` cmd
pnpm package
```

## 版本
### 2026-11-25
增加命名Cell和引用替换

如

``` sql
-- @name a 
select b from a where 1=1
```

``` sql
-- @ref a
select * from b where b.id={{a.b}}
```



































































