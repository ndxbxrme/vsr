(function() {
  'use strict';
  var e, error, module;

  module = null;

  try {
    module = angular.module('ndx');
  } catch (error) {
    e = error;
    module = angular.module('ndx', []);
  }

  module.directive('pagination', function() {
    return {
      restrict: 'AE',
      require: 'ngModel',
      template: "<div ng-show=\"totalPages &gt; 1\" class=\"pagination\"> <style type=\"text/css\">.pagination {display: flex;}.pagination .page {padding: 0.5rem;min-width: 1.2rem;cursor: pointer;user-select: none;}.pagination .page.selected {color: #f00;}.pagination .page.disabled {opacity: 0.5;pointer-events: none;}</style> <div ng-click=\"setPage(ngModel - 1)\" ng-class=\"{disabled:ngModel&lt;2}\" ng-hide=\"hidePrevNext\" class=\"page prev\">{{prevText}}</div> <div ng-click=\"setPage(1)\" ng-show=\"showFirstLast\" class=\"page firstNumber\">{{firstText}}</div> <div ng-click=\"setPage(1)\" ng-show=\"ellipsisPre\" class=\"page first\">1</div> <div ng-show=\"ellipsisPre\" class=\"page ellipsis pre\">{{ellipsisText}}</div> <div ng-repeat=\"myPage in (allPages = getPages())\" ng-click=\"setPage(myPage)\" ng-class=\"{selected:ngModel===myPage}\" class=\"page number\">{{myPage}}</div> <div ng-show=\"ellipsisPost\" class=\"page ellipsis post\">{{ellipsisText}}</div> <div ng-click=\"setPage(totalPages)\" ng-show=\"ellipsisPost\" class=\"page lastNumber\">{{totalPages}}</div> <div ng-click=\"setPage(totalPages)\" ng-show=\"showFirstLast\" class=\"page last\">{{lastText}}</div> <div ng-click=\"setPage(ngModel + 1)\" ng-class=\"{disabled:ngModel&gt;totalPages-1}\" ng-hide=\"hidePrevNext\" class=\"page next\">{{nextText}}</div> </div>",
      replace: true,
      scope: {
        ngModel: '=',
        pageSize: '=',
        total: '=',
        showFirstLast: '=',
        firstText: '@',
        lastText: '@',
        showAllPages: '=',
        pagesToShow: '=',
        hidePrevNext: '=',
        prevText: '@',
        nextText: '@',
        ellipsisText: '@',
        pageChange: '&'
      },
      link: function(scope, elem) {
        scope.totalPages = 0;
        scope.getPages = function() {
          var end, i, pages, pagesToShow;
          scope.firstText = scope.firstText || 'First';
          scope.lastText = scope.lastText || 'Last';
          scope.prevText = scope.prevText || '<<';
          scope.nextText = scope.nextText || '>>';
          scope.ellipsisText = scope.ellipsisText || '..';
          pages = [];
          pagesToShow = scope.pagesToShow || 5;
          i = Math.max(0, scope.ngModel - Math.ceil(pagesToShow / 2));
          end = i + pagesToShow;
          scope.totalPages = Math.ceil(scope.total / scope.pageSize);
          if (end > scope.totalPages) {
            end = scope.totalPages;
            i = Math.max(0, end - pagesToShow);
          }
          scope.ellipsisPre = false;
          if (i > 0) {
            scope.ellipsisPre = true;
          }
          scope.ellipsisPost = false;
          if (i + pagesToShow < scope.totalPages) {
            scope.ellipsisPost = true;
          }
          while (i++ < Math.min(scope.totalPages, end)) {
            pages.push(i);
          }
          if (scope.ngModel > scope.totalPages) {
            scope.ngModel = 1;
          }
          return pages;
        };
        return scope.setPage = function(page) {
          var base;
          scope.ngModel = page;
          return typeof scope.pageChange === "function" ? typeof (base = scope.pageChange()) === "function" ? base(page) : void 0 : void 0;
        };
      }
    };
  });

}).call(this);

//# sourceMappingURL=index.js.map
