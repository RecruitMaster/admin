"use strict";

const testEmail = function (email) {
    return /^(([^<>()\[\]\.,;:\s@\"]+(\.[^<>()\[\]\.,;:\s@\"]+)*)|(\".+\"))@(([^<>()[\]\.,;:\s@\"]+\.)+[^<>()[\]\.,;:\s@\"]{2,})$/i.test(email);
}


const checkEmptyFormFields = function (form, fields) {
    let button = form.find("button[type='submit']");
    form.find("input, textarea").removeClass("alert-danger");
    form.find(".alert-message").css("display", "none").removeClass("alert-danger alert-success alert-warning");
    button.attr("disabled", true);
    let checkFields = false;
    fields.each(function(){
        if ($(this).val().trim() === "") {
            $(this).addClass("alert-danger");
            checkFields = true;
        }
    });

    if (checkFields) {
        form.find(".alert-message").addClass("alert-danger").text("Fill required fields").css("display", "block");
        button.attr("disabled", false);
        return false;
    } else {
        return true;
    }

}


const messageModal = function (message) {
    let modal = $("#message-modal");
    modal.find(".mm-title").html(message.title);
    modal.find(".mm-text").html(message.text);
    modal.find(".message-modal-btn").css("display", "block");
    if (message.info === "confirm") {
        modal.find(".confirm-modal-btn").css("display", "block");
        modal.find(".message-modal-btn").css("display", "none");
    }
    modal.modal("show");
}



const confirmModal = function (text) {
    return new Promise (function(resolve, reject){
        messageModal({title: "РџСЂРµРґСѓРїСЂРµР¶РґРµРЅРёРµ", text: text, info: "confirm"});
        let confirm = false;
        $("#message-modal").find(".confirm-modal-btn .btn-primary").on("click", function(event){
            event.preventDefault();
            $("#message-modal").modal("hide");
            confirm = true;
        });
        $("#message-modal").on("hidden.bs.modal", function(){
            $("#message-modal").find(".confirm-modal-btn").css("display", "none");
            $(this).off("click");
            $(this).off("hidden.bs.modal");
            confirm ? resolve (true) : resolve (false);
        });
    });

}


let urlParams = new URLSearchParams(window.location.search);

$(document).ready(function () {

    $(".preloader").fadeOut(1000);

    moment.locale("ru");

    $(".date").each(function(){
    	$(this).text() !== "" ? $(this).text(moment(new Date($(this).text())).format("DD.MM.YYYY")) : null;
    });

    $('.nl2br').each(function(){
        $(this).html($(this).text().replace(/\r?\n/g, '<br/>'));
    })

    $('input, textarea').on('focus', function(){
        $(this).removeClass('alert-danger');
    });

    $(function () {
        $('[data-toggle="tooltip"]').tooltip();
    })

    // login form
    $("#a_login").on("submit", function(event){
        event.preventDefault();
        let _this = $(this);
        let button = _this.find("button[type='submit']");

        let check = checkEmptyFormFields(
            _this,
            _this.find("input")
        );

        if (!check) {
            return false;
        }

        const data = _this.serialize();

        $.ajax({  url: "/auth/login",  method: "POST",   data: data}).done((result) => {
            if (result.message !== 'ok') {
                _this.find(".alert-message").addClass("alert-danger").text(result.message).css("display", "block");
                button.attr("disabled", false);
            } else {
                _this.find(".alert-message").addClass("alert-success").text("Success").css("display", "block");
                setTimeout(() => {
                    _this.find("input").val("");
                    _this.find("textarea").val("");
                    _this.find(".alert-message").css("display", "none").removeClass("alert-danger alert-success");
                    button.attr("disabled", false);
                    window.location.href = '/main';
                }, 1000);
            }

        }).fail((err)=> {
            _this.find(".alert-message").addClass("alert-danger").text("Server error").css("display", "block");
            button.attr("disabled", false);
            console.log(err);
        });


    });

    // logout user
    $('.a_logout').on('click', function(event){
        event.preventDefault();
        let _this = $(this);

        _this.attr("disabled", true);
        $.ajax({url: '/auth/logout', method: 'POST'}).done(r=>{
            window.location.href = "/auth/login";
        }).fail((err)=>{
            console.log(err);
            _this.attr("disabled", false);
            messageModal({title: "Error", text: "Server error"});
        });


    });




});
