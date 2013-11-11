#include "../include/TestState.hpp"
#include "../include/StateIdentifiers.hpp"

TestState::TestState(StateStack& stateStack)
    : State(stateStack)
{
    // menu.addItem("Hello");
    // menu.addItem("World");
    // menu.addItem("asdf");
    // menu.addItem("fdsa");
    // menu.addMenu("Nested!");
    //     menu.addItem("asdfasdf");
    //     menu.addItem("1234");
    //     menu.addItem("4567");
    // menu.endMenu();

    // menu.finalize();
}

TestState::~TestState()
{
}

void TestState::draw()
{
    TCODConsole::root->print(11, 10, "HELLO LIBTCOD WORLD!");
    // menu.draw(15, 15);
}

bool TestState::update()
{
    return false;
}

bool TestState::handleInput(TCOD_key_t key)
{
    // menu.handleInput(key);
    if (key.c == 'a')
        requestStackPush(States::Debug);

    return false;
}
