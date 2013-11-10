#ifndef _Menu_hpp_
#define _Menu_hpp_

#include <string>
#include <vector>
#include <memory>

#include <libtcod.hpp>

class Menu
{
    public:
    struct MenuItem
    {
        public:
        std::string label;
        bool selectable;
        std::unique_ptr<Menu> menu;
    };

    public:
    Menu();
    // Menu(std::vector<std::string> list);
    ~Menu();

    void addItem(const std::string& label);
    void addItems(const std::vector<std::string> items);

    void addLabel(const std::string& label);

    void addMenu(const std::string& label);
    void finalize();

    void draw(int x, int y);
    void update();
    void handleInput(TCOD_key_t key);

    private:
    const int getLongest() const;

    private:
    std::unique_ptr<TCODConsole> console;

    std::vector<MenuItem> items;
    int selectionId;
};

#endif // _Menu_hpp_
