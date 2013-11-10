#include "../include/TestState.hpp"
#include "../include/StateIdentifiers.hpp"

TestState::TestState(StateStack& stateStack)
    : State(stateStack)
{
    menu = new Menu({"One", "Two", "Three", "Four"});
}

TestState::~TestState()
{
    delete menu;
}

void TestState::draw()
{
    TCODConsole::root->print(11, 10, "HELLO LIBTCOD WORLD!");

    menu->draw(20, 20);
}

bool TestState::update()
{
    return false;
}

bool TestState::handleInput(TCOD_key_t key)
{
    if (key.c == 'a')
        requestStackPush(States::Debug);

    menu->handleInput(key);

    return false;
}
