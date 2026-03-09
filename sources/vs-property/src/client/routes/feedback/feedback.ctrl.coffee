'use strict'

angular.module 'vsProperty'
.controller 'FeedbackCtrl', ($scope, $interval, $http, $timeout, $compile, dezrez) ->
  $scope.sort = '-date'
  dezrez.fetchViewings()
  $scope.getProperties = dezrez.getProperties
  $scope.loading = dezrez.loading
  $scope.selectedViewing = null
  
  # Create modal element and append to body
  modalTemplate = '''
    <div class="modal fade" id="feedbackModal" tabindex="-1" role="dialog" aria-labelledby="feedbackModalLabel">
      <div class="modal-dialog" role="document">
        <div class="modal-content">
          <div class="modal-header">
            <button type="button" class="close" data-dismiss="modal" aria-label="Close">
              <span aria-hidden="true">&times;</span>
            </button>
            <h4 class="modal-title" id="feedbackModalLabel">Viewing Details</h4>
            <div class="modal-subtitle" ng-show="selectedViewing">
              <div class="person">
                <img gravatar-src="selectedViewing.MainContact.email">
                <span>{{selectedViewing.MainContact.name}}</span>
              </div>
              <span> - {{selectedViewing.StartDate | date:'mediumDate'}} at {{selectedViewing.StartDate | date:'shortTime'}}</span>
            </div>
          </div>
          <div class="modal-body">
            <div class="feedback-container" ng-show="selectedViewing">
              <div class="viewing-feedback" ng-show="selectedViewing.Feedback.length">
                <div class="feedback-header">
                  <h4>Viewing Notes</h4>
                </div>
                <div class="feedback-list">
                  <div class="feedback-entry" ng-repeat="feedback in selectedViewing.Feedback">
                    <h6>{{feedback.DateTime | date:'mediumDate'}}, {{feedback.DateTime | date:'shortTime'}}</h6>
                    <p>{{feedback.Feedback}}</p>
                  </div>
                </div>
              </div>
              <div class="feedback-request" ng-show="selectedViewing.Notes.length">
                <div class="feedback-header">
                  <h4>Feedback Request</h4>
                </div>
                <div class="feedback-list">
                  <div class="feedback-entry" ng-repeat="note in selectedViewing.Notes">
                    <h6>{{note.DateAdded | date:'mediumDate'}}, {{note.DateAdded | date:'shortTime'}}</h6>
                    <p>{{note.Note}}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    </div>
  '''
  
  # Compile and append modal to body
  modalElement = $compile(modalTemplate)($scope)
  angular.element('body').append(modalElement)
  
  $scope.openFeedbackModal = (viewing) ->
    $scope.selectedViewing = viewing
    $timeout ->
      $('#feedbackModal').modal('show')
    , 0
  
  $scope.$on '$destroy', ->
    $('#feedbackModal').modal('hide')
    modalElement.remove()
    $scope.selectedViewing = null
      